import type { ApplyOutcome } from './types.js';
import { collectConflictFiles, execGit } from './shell.js';
import { removeWorktree } from './git-write.js';

// ---------------------------------------------------------------------------
// applyBranchToBaseUnstaged
// ---------------------------------------------------------------------------

/**
 * Apply task branch changes to the base branch as unstaged changes.
 * Uses `git merge --squash --no-commit`, then `git reset HEAD`.
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

/** Merge with --no-ff (creates a merge commit on base branch). */
export function applyMergeNoFf(
  repoPath: string,
  taskBranch: string,
  baseBranch: string,
  worktreePath?: string,
): ApplyOutcome {
  if (worktreePath) removeWorktree(repoPath, worktreePath);

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

  execGit(repoPath, ['branch', '-D', taskBranch]);

  return { ok: true, result: { filesChanged, baseBranch } };
}

// ---------------------------------------------------------------------------
// applyRebase
// ---------------------------------------------------------------------------

/** Rebase task branch onto base branch, then fast-forward base. */
export function applyRebase(
  repoPath: string,
  taskBranch: string,
  baseBranch: string,
  worktreePath?: string,
): ApplyOutcome {
  if (worktreePath) removeWorktree(repoPath, worktreePath);

  const checkout = execGit(repoPath, ['checkout', taskBranch]);
  if (!checkout.success) {
    return { ok: false, error: `failed to checkout ${taskBranch}` };
  }

  const rebase = execGit(repoPath, ['rebase', baseBranch]);
  if (!rebase.success) {
    execGit(repoPath, ['rebase', '--abort']);
    const conflictedFiles = collectConflictFiles(repoPath);
    const files = conflictedFiles.length > 0
      ? conflictedFiles
      : [`Rebase conflict: ${rebase.stderr.trim()}`];
    return { ok: false, conflict: { conflictedFiles: files } };
  }

  execGit(repoPath, ['checkout', baseBranch]);
  const ff = execGit(repoPath, ['merge', '--ff-only', taskBranch]);
  if (!ff.success) {
    return { ok: false, error: `failed to fast-forward ${baseBranch}: ${ff.stderr.trim()}` };
  }

  const stat = execGit(repoPath, ['diff', '--stat', 'HEAD~1..HEAD']);
  const lines = stat.stdout.split('\n').filter((l) => l.trim().length > 0);
  const filesChanged = Math.max(0, lines.length - 1);

  execGit(repoPath, ['branch', '-d', taskBranch]);

  return { ok: true, result: { filesChanged, baseBranch } };
}

// ---------------------------------------------------------------------------
// applyWorktreeToBaseUnstaged
// ---------------------------------------------------------------------------

/**
 * Apply worktree branch changes to the base branch as unstaged changes.
 * The main repo is already on the base branch (worktree isolation).
 * After merge, removes the worktree.
 */
export function applyWorktreeToBaseUnstaged(
  repoPath: string,
  taskBranch: string,
  baseBranch: string,
  worktreePath: string,
): ApplyOutcome {
  const currentResult = execGit(repoPath, ['rev-parse', '--abbrev-ref', 'HEAD']);
  const currentBranch = currentResult.stdout.trim();
  if (currentBranch !== baseBranch) {
    const checkout = execGit(repoPath, ['checkout', baseBranch]);
    if (!checkout.success) {
      return { ok: false, error: `failed to checkout ${baseBranch}: ${checkout.stderr.trim()}` };
    }
  }

  const merge = execGit(repoPath, ['merge', '--squash', '--no-commit', taskBranch]);
  if (!merge.success) {
    const conflictedFiles = collectConflictFiles(repoPath);
    execGit(repoPath, ['merge', '--abort']);
    return { ok: false, conflict: { conflictedFiles } };
  }

  // Count only files brought in by the squash merge (staged), not the full working tree
  const staged = execGit(repoPath, ['diff', '--cached', '--name-only']);
  const filesChanged = staged.stdout
    .split('\n')
    .filter((l) => l.trim().length > 0).length;

  execGit(repoPath, ['reset', 'HEAD']);

  removeWorktree(repoPath, worktreePath);
  execGit(repoPath, ['branch', '-D', taskBranch]);

  return { ok: true, result: { filesChanged, baseBranch } };
}
