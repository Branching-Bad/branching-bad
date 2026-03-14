import { spawnSync } from 'child_process';
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
    // Worktree exists — commit any uncommitted changes, then diff via HEAD
    const wtStatus = execGit(worktreePath, ['status', '--porcelain']);
    if (wtStatus.success && wtStatus.stdout.trim()) {
      execGit(worktreePath, ['add', '-A']);
      execGit(worktreePath, ['commit', '-m', 'agent: apply uncommitted changes']);
    }

    // `baseBranch...HEAD` = changes on HEAD since common ancestor with baseBranch
    const diff = execGit(worktreePath, ['diff', `${baseBranch}...HEAD`]);
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
    const diff = execGit(repoPath, ['diff', `${baseBranch}...${taskBranch}`]);
    if (!diff.success) {
      return { ok: false, error: `failed to generate diff: ${diff.stderr.trim()}` };
    }
    patchContent = diff.stdout;
  }

  if (!patchContent.trim()) {
    return { ok: true, result: { filesChanged: 0, baseBranch } };
  }

  // Apply patch to working tree. Unlike `git merge --squash`, `git apply`
  // does NOT require a clean tree — main's dirty state is preserved.
  const applyResult = applyPatchSafe(repoPath, patchContent);

  if (!applyResult.ok) {
    execGit(repoPath, ['reset', 'HEAD']);
    // On conflict: keep worktree + branch — agent needs them for reference
    return applyResult;
  }

  // Unstage anything --3way may have staged so changes appear as unstaged
  execGit(repoPath, ['reset', 'HEAD']);

  return { ok: true, result: { filesChanged: applyResult.filesChanged, baseBranch } };
}

// ---------------------------------------------------------------------------
// applyPatchSafe — robust patch application
// ---------------------------------------------------------------------------

/**
 * Try bulk `git apply` first. If it fails, apply per-file patches:
 * plain apply for new files, --3way for modifications (creates conflict markers).
 */
type ApplyPatchResult =
  | { ok: true; filesChanged: number }
  | { ok: false; conflict: { conflictedFiles: string[] } }
  | { ok: false; error: string };

function applyPatchSafe(repoPath: string, patchContent: string): ApplyPatchResult {
  // Fast path: try plain apply (handles new files, untracked, no-conflict cases)
  const bulk = gitApply(repoPath, patchContent, false);
  if (bulk.status === 0) {
    return { ok: true, filesChanged: countPatchFiles(patchContent) };
  }

  // Slow path: apply per-file. --3way partially applies but fails on files
  // not in index (new files). Per-file approach handles each case correctly.
  const filePatches = splitPatchByFile(patchContent);
  const failedFiles: string[] = [];

  for (const { file, content } of filePatches) {
    const plain = gitApply(repoPath, content, false);
    if (plain.status === 0) continue;

    const threeWay = gitApply(repoPath, content, true);
    if (threeWay.status === 0) continue;

    failedFiles.push(file);
  }

  if (failedFiles.length > 0) {
    const conflictedFiles = collectConflictFiles(repoPath);
    const files = conflictedFiles.length > 0 ? conflictedFiles : failedFiles;
    return { ok: false, conflict: { conflictedFiles: files } };
  }

  return { ok: true, filesChanged: filePatches.length };
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

function splitPatchByFile(patch: string): { file: string; content: string }[] {
  const parts: { file: string; content: string }[] = [];
  const lines = patch.split('\n');
  let current: string[] = [];
  let currentFile = '';

  for (const line of lines) {
    if (line.startsWith('diff --git ')) {
      if (current.length > 0 && currentFile) {
        parts.push({ file: currentFile, content: current.join('\n') + '\n' });
      }
      current = [line];
      const match = line.match(/diff --git a\/(.*) b\/(.*)/);
      currentFile = match ? match[2] : '';
    } else {
      current.push(line);
    }
  }
  if (current.length > 0 && currentFile) {
    parts.push({ file: currentFile, content: current.join('\n') + '\n' });
  }

  return parts;
}

function countPatchFiles(patch: string): number {
  return patch.split('\n').filter((l) => l.startsWith('diff --git')).length;
}
