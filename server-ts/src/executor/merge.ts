import { spawnSync } from 'child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import os from 'os';
import path from 'path';

import type { ApplyOutcome } from './types.js';
import { collectConflictFiles, execGit } from './shell.js';
// Note: removeWorktree is NOT called here — worktree cleanup happens only on ARCHIVE

// ---------------------------------------------------------------------------
// applyBranchToBaseUnstaged
// ---------------------------------------------------------------------------

/**
 * Apply task branch changes to the base branch as unstaged changes.
 * Uses `git merge --squash --no-commit`, then `git reset HEAD`.
 * For non-worktree (direct mode) tasks only.
 */
export function applyBranchToBaseUnstaged(
  repoPath: string,
  taskBranch: string,
  baseBranch: string,
): ApplyOutcome {
  const stashResult = execGit(repoPath, ['stash']);
  const hadStash = stashResult.success && !stashResult.stdout.trim().includes('No local changes');

  const checkout = execGit(repoPath, ['checkout', baseBranch]);
  if (!checkout.success) {
    if (hadStash) execGit(repoPath, ['stash', 'pop']);
    return { ok: false, error: `failed to checkout ${baseBranch}: ${checkout.stderr.trim()}` };
  }

  const merge = execGit(repoPath, ['merge', '--squash', '--no-commit', taskBranch]);
  if (!merge.success) {
    const conflictedFiles = collectConflictFiles(repoPath);
    execGit(repoPath, ['merge', '--abort']);
    execGit(repoPath, ['checkout', taskBranch]);
    if (hadStash) execGit(repoPath, ['stash', 'pop']);
    return { ok: false, conflict: { conflictedFiles } };
  }

  // Count only files brought in by the squash merge (staged), not the full working tree
  const staged = execGit(repoPath, ['diff', '--cached', '--name-only']);
  const filesChanged = staged.stdout
    .split('\n')
    .filter((l) => l.trim().length > 0).length;

  execGit(repoPath, ['reset', 'HEAD']);

  return { ok: true, result: { filesChanged, baseBranch } };
}

// ---------------------------------------------------------------------------
// applyMergeNoFf
// ---------------------------------------------------------------------------

/**
 * Merge with --no-ff (creates a merge commit on base branch).
 * Worktree and branch are NOT deleted — cleanup happens only on ARCHIVE.
 */
export function applyMergeNoFf(
  repoPath: string,
  taskBranch: string,
  baseBranch: string,
  worktreePath?: string,
): ApplyOutcome {
  // If worktree has uncommitted changes, commit them so merge sees everything
  if (worktreePath) {
    const wtStatus = execGit(worktreePath, ['status', '--porcelain']);
    if (wtStatus.success && wtStatus.stdout.trim()) {
      execGit(worktreePath, ['add', '-A']);
      execGit(worktreePath, ['commit', '-m', 'agent: apply uncommitted changes']);
    }
  }

  const checkout = execGit(repoPath, ['checkout', baseBranch]);
  if (!checkout.success) {
    return { ok: false, error: `failed to checkout ${baseBranch}: ${checkout.stderr.trim()}` };
  }

  const merge = execGit(repoPath, ['merge', '--no-ff', taskBranch]);
  if (!merge.success) {
    const conflictedFiles = collectConflictFiles(repoPath);
    execGit(repoPath, ['merge', '--abort']);
    return { ok: false, conflict: { conflictedFiles } };
  }

  const stat = execGit(repoPath, ['diff', '--stat', 'HEAD~1..HEAD']);
  const lines = stat.stdout.split('\n').filter((l) => l.trim().length > 0);
  const filesChanged = Math.max(0, lines.length - 1);

  return { ok: true, result: { filesChanged, baseBranch } };
}

// ---------------------------------------------------------------------------
// applyRebase
// ---------------------------------------------------------------------------

/**
 * Rebase task branch onto base branch, then fast-forward base.
 * When worktree exists, rebase runs FROM the worktree (where taskBranch
 * is already checked out) to avoid the git worktree branch lock.
 * Worktree and branch are NOT deleted — cleanup happens only on ARCHIVE.
 */
export function applyRebase(
  repoPath: string,
  taskBranch: string,
  baseBranch: string,
  worktreePath?: string,
): ApplyOutcome {
  // If worktree has uncommitted changes, commit them first
  if (worktreePath) {
    const wtStatus = execGit(worktreePath, ['status', '--porcelain']);
    if (wtStatus.success && wtStatus.stdout.trim()) {
      execGit(worktreePath, ['add', '-A']);
      execGit(worktreePath, ['commit', '-m', 'agent: apply uncommitted changes']);
    }
  }

  // Rebase: run from whichever directory has taskBranch checked out
  const rebaseDir = worktreePath ?? repoPath;
  if (!worktreePath) {
    // No worktree — need to checkout taskBranch in main repo
    const checkout = execGit(repoPath, ['checkout', taskBranch]);
    if (!checkout.success) {
      return { ok: false, error: `failed to checkout ${taskBranch}` };
    }
  }

  const rebase = execGit(rebaseDir, ['rebase', baseBranch]);
  if (!rebase.success) {
    execGit(rebaseDir, ['rebase', '--abort']);
    const conflictedFiles = collectConflictFiles(rebaseDir);
    const files = conflictedFiles.length > 0
      ? conflictedFiles
      : [`Rebase conflict: ${rebase.stderr.trim()}`];
    return { ok: false, conflict: { conflictedFiles: files } };
  }

  // Fast-forward baseBranch to the rebased taskBranch
  execGit(repoPath, ['checkout', baseBranch]);
  const ff = execGit(repoPath, ['merge', '--ff-only', taskBranch]);
  if (!ff.success) {
    return { ok: false, error: `failed to fast-forward ${baseBranch}: ${ff.stderr.trim()}` };
  }

  const stat = execGit(repoPath, ['diff', '--stat', 'HEAD~1..HEAD']);
  const lines = stat.stdout.split('\n').filter((l) => l.trim().length > 0);
  const filesChanged = Math.max(0, lines.length - 1);

  return { ok: true, result: { filesChanged, baseBranch } };
}

// ---------------------------------------------------------------------------
// applyWorktreeToBaseUnstaged
// ---------------------------------------------------------------------------

/**
 * Apply worktree branch changes to the base branch as unstaged changes.
 * Uses `git diff` + `git apply` so main's dirty state is preserved.
 * Falls back to per-file application with --3way for conflicts.
 * Worktree and branch are NOT deleted — cleanup happens only on ARCHIVE.
 */
export function applyWorktreeToBaseUnstaged(
  repoPath: string,
  taskBranch: string,
  baseBranch: string,
  worktreePath: string,
): ApplyOutcome {
  // Generate the patch. Two strategies depending on whether the worktree
  // directory still exists (it may have been cleaned up on server restart).
  let patchContent: string;

  const wtCheck = execGit(worktreePath, ['rev-parse', '--git-dir']);
  if (wtCheck.success) {
    // Worktree exists — commit any uncommitted changes, then diff against main tip.
    const wtStatus = execGit(worktreePath, ['status', '--porcelain']);
    if (wtStatus.success && wtStatus.stdout.trim()) {
      execGit(worktreePath, ['add', '-A']);
      execGit(worktreePath, ['commit', '-m', 'agent: apply uncommitted changes']);
    }

    // Two-dot: diff from main tip to task HEAD. This yields only the net delta
    // the task introduces over the current main, so changes main already has
    // (e.g. resolved by a prior task) are not replayed.
    const diff = execGit(worktreePath, ['diff', `${baseBranch}..HEAD`]);
    if (!diff.success) {
      return { ok: false, error: `failed to generate diff: ${diff.stderr.trim()}` };
    }
    patchContent = diff.stdout;
  } else {
    // Worktree gone (server restart / manual cleanup). Try the branch directly.
    const branchCheck = execGit(repoPath, ['rev-parse', '--verify', taskBranch]);
    if (!branchCheck.success) {
      return { ok: false, error: `Branch ${taskBranch} not found and worktree is gone. Re-run the task.` };
    }
    const diff = execGit(repoPath, ['diff', `${baseBranch}..${taskBranch}`]);
    if (!diff.success) {
      return { ok: false, error: `failed to generate diff: ${diff.stderr.trim()}` };
    }
    patchContent = diff.stdout;
  }

  if (!patchContent.trim()) {
    return { ok: true, result: { filesChanged: 0, baseBranch } };
  }

  // Apply via stash-then-pop so main's existing dirty state is preserved via
  // git's 3-way merge, and `git apply` sees a clean working tree.
  const applyResult = applyPatchPreservingDirty(repoPath, patchContent);

  if (!applyResult.ok) {
    execGit(repoPath, ['reset', 'HEAD']);
    // On conflict: keep worktree + branch — agent needs them for reference
    return applyResult;
  }

  // Unstage anything git may have staged so changes appear as unstaged
  execGit(repoPath, ['reset', 'HEAD']);

  return { ok: true, result: { filesChanged: applyResult.filesChanged, baseBranch } };
}

// ---------------------------------------------------------------------------
// applyPatchPreservingDirty — apply patch while preserving main's dirty state
// ---------------------------------------------------------------------------

/**
 * Stash any uncommitted state on the target, apply the patch to the clean
 * working tree, then pop the stash so git's 3-way merge reintegrates the
 * pre-existing dirty state. If the pop surfaces conflicts, the conflicted
 * files are reported and the markers are left in place for resolution.
 *
 * The patch is assumed to be a two-dot diff against the target's current
 * HEAD, so plain `git apply` is sufficient.
 */
type ApplyPatchResult =
  | { ok: true; filesChanged: number }
  | { ok: false; conflict: { conflictedFiles: string[] } }
  | { ok: false; error: string };

/**
 * Per-file 3-way reconciliation: for each file the patch touches, snapshot its
 * current (possibly-dirty) content, reset it to HEAD, apply the patch to a
 * clean tree, then merge the original dirty content back in via `git merge-file`.
 * Conflicts are written as `<<<<<<<` markers in the working tree file and the
 * file is reported in `conflictedFiles`.
 */
function applyPatchPreservingDirty(repoPath: string, patchContent: string): ApplyPatchResult {
  const patchFiles = extractFilesFromPatch(patchContent);
  if (patchFiles.length === 0) {
    return { ok: true, filesChanged: 0 };
  }

  // Snapshot current (ours) + HEAD (base) for each patch-touched file.
  const ours = new Map<string, string | null>();
  const base = new Map<string, string | null>();
  const dirtyFiles = new Set<string>();

  for (const rel of patchFiles) {
    const abs = path.join(repoPath, rel);
    ours.set(rel, existsSync(abs) ? readFileSync(abs, 'utf-8') : null);

    const show = execGit(repoPath, ['show', `HEAD:${rel}`]);
    base.set(rel, show.success ? show.stdout : null);

    if ((ours.get(rel) ?? null) !== (base.get(rel) ?? null)) {
      dirtyFiles.add(rel);
    }
  }

  // Reset tracked files (in the paths the patch touches) to HEAD so apply sees
  // a clean context. Untracked files elsewhere are untouched.
  const checkoutArgs = ['checkout', 'HEAD', '--', ...patchFiles];
  execGit(repoPath, checkoutArgs);

  const apply = gitApply(repoPath, patchContent, false);
  if (apply.status !== 0) {
    restoreDirty(repoPath, patchFiles, ours);
    return { ok: false, error: `git apply failed: ${apply.stderr?.toString().trim() ?? 'unknown error'}` };
  }

  if (dirtyFiles.size === 0) {
    return { ok: true, filesChanged: patchFiles.length };
  }

  const conflictedFiles: string[] = [];
  for (const rel of dirtyFiles) {
    const abs = path.join(repoPath, rel);
    const theirs = existsSync(abs) ? readFileSync(abs, 'utf-8') : '';
    const result = mergeThreeWay(ours.get(rel) ?? '', base.get(rel) ?? '', theirs);

    if (result === null) {
      restoreDirty(repoPath, patchFiles, ours);
      return { ok: false, error: `merge-file failed for ${rel}` };
    }
    writeFileSync(abs, result.content);
    if (result.conflicts > 0) conflictedFiles.push(rel);
  }

  if (conflictedFiles.length > 0) {
    return { ok: false, conflict: { conflictedFiles } };
  }
  return { ok: true, filesChanged: patchFiles.length };
}

function extractFilesFromPatch(patch: string): string[] {
  const files: string[] = [];
  for (const line of patch.split('\n')) {
    const m = line.match(/^diff --git a\/(.+?) b\/(.+)$/);
    if (m) files.push(m[2]);
  }
  return files;
}

function restoreDirty(
  repoPath: string,
  files: string[],
  ours: Map<string, string | null>,
): void {
  for (const rel of files) {
    const abs = path.join(repoPath, rel);
    const snap = ours.get(rel) ?? null;
    if (snap === null) {
      if (existsSync(abs)) rmSync(abs, { force: true });
    } else {
      writeFileSync(abs, snap);
    }
  }
}

/**
 * 3-way merge via `git merge-file -p`. Exit 0 = clean merge, positive = number of
 * conflicts, negative = tool error. Returns null on tool error.
 */
function mergeThreeWay(
  oursContent: string,
  baseContent: string,
  theirsContent: string,
): { content: string; conflicts: number } | null {
  const tmp = mkdtempSync(path.join(os.tmpdir(), 'bb-merge-'));
  try {
    const oursPath = path.join(tmp, 'ours');
    const basePath = path.join(tmp, 'base');
    const theirsPath = path.join(tmp, 'theirs');
    writeFileSync(oursPath, oursContent);
    writeFileSync(basePath, baseContent);
    writeFileSync(theirsPath, theirsContent);

    const res = spawnSync(
      'git',
      ['merge-file', '-p', '-L', 'main', '-L', 'ancestor', '-L', 'task', oursPath, basePath, theirsPath],
      { encoding: 'utf-8', shell: process.platform === 'win32' },
    );
    if (res.status === null || res.status < 0) return null;
    return { content: res.stdout, conflicts: res.status };
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

function gitApply(repoPath: string, patch: string, threeWay: boolean) {
  const args = ['-C', repoPath, 'apply'];
  if (threeWay) args.push('--3way');
  return spawnSync('git', args, {
    input: patch,
    encoding: 'utf-8',
    stdio: ['pipe', 'pipe', 'pipe'],
    shell: process.platform === 'win32',
  });
}

function countPatchFiles(patch: string): number {
  return patch.split('\n').filter((l) => l.startsWith('diff --git')).length;
}
