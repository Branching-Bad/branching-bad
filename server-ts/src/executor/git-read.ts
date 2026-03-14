import which from 'which';

import type { GitStatusInfo } from './types.js';
import { execGit, gitOutput } from './shell.js';

// ---------------------------------------------------------------------------
// Repository validation
// ---------------------------------------------------------------------------

/** Check if path is a git repository. Throws if not. */
export function assertGitRepo(repoPath: string): void {
  const result = execGit(repoPath, ['rev-parse', '--is-inside-work-tree']);
  if (!result.success) {
    throw new Error('selected repository path is not a git repository');
  }
  if (result.stdout.trim() !== 'true') {
    throw new Error('selected repository path is not inside a git work tree');
  }
}

// ---------------------------------------------------------------------------
// Diff and SHA utilities
// ---------------------------------------------------------------------------

/**
 * Capture all changes in a working directory: unstaged, staged, and committed.
 * `baseSha` is the commit the branch was forked from.
 */
const DIFF_EXCLUDE = [':(exclude).branching-bad'];

export function captureDiffWithBase(repoPath: string, baseSha?: string): string {
  const unstaged = gitOutput(repoPath, ['diff', '--', '.', ...DIFF_EXCLUDE]);
  if (unstaged.trim().length > 0) return unstaged;

  const staged = gitOutput(repoPath, ['diff', '--cached', '--', '.', ...DIFF_EXCLUDE]);
  if (staged.trim().length > 0) return staged;

  if (baseSha) {
    const committed = gitOutput(repoPath, ['diff', baseSha, 'HEAD', '--', '.', ...DIFF_EXCLUDE]);
    if (committed.trim().length > 0) return committed;
  }

  return '';
}

/** Get the current HEAD commit SHA. Returns undefined if unavailable. */
export function getHeadSha(repoPath: string): string | undefined {
  const result = execGit(repoPath, ['rev-parse', 'HEAD']);
  if (!result.success) return undefined;
  const sha = result.stdout.trim();
  return sha.length > 0 ? sha : undefined;
}

// ---------------------------------------------------------------------------
// Branch utilities
// ---------------------------------------------------------------------------

/** Detect the base branch, preferring a configured default if provided. */
export function detectBaseBranchWithDefault(repoPath: string, configured?: string): string {
  const candidates: string[] = [];

  if (configured && configured.length > 0) {
    candidates.push(configured);
  }
  for (const fallback of ['main', 'master']) {
    if (!candidates.includes(fallback)) {
      candidates.push(fallback);
    }
  }

  for (const candidate of candidates) {
    const result = execGit(repoPath, ['rev-parse', '--verify', candidate]);
    if (result.success) return candidate;
  }

  throw new Error(`could not detect base branch (tried ${candidates.join(', ')})`);
}

/** List local branches for a repo. */
export function listBranches(repoPath: string): string[] {
  assertGitRepo(repoPath);

  const result = execGit(repoPath, ['branch', '--format=%(refname:short)']);
  const branches = result.stdout
    .split('\n')
    .filter((l) => l.trim().length > 0);

  branches.sort();
  return [...new Set(branches)];
}

// ---------------------------------------------------------------------------
// Status info
// ---------------------------------------------------------------------------

/** Get git status info: commits, diff stat, ahead/behind counts. */
export function gitStatusInfo(
  repoPath: string,
  baseBranch: string,
  taskBranch: string,
): GitStatusInfo {
  const logResult = execGit(repoPath, ['log', '--oneline', `${baseBranch}..${taskBranch}`]);
  const commits = logResult.stdout
    .split('\n')
    .filter((l) => l.trim().length > 0);

  const diffResult = execGit(repoPath, ['diff', '--stat', `${baseBranch}..${taskBranch}`]);
  const diffStat = diffResult.stdout.trim();

  const revListResult = execGit(repoPath, ['rev-list', '--count', `${taskBranch}..${baseBranch}`]);
  const behind = parseInt(revListResult.stdout.trim(), 10) || 0;

  return { commits, diffStat, ahead: commits.length, behind };
}

/** Check if the `gh` CLI is available on PATH. */
export function hasGhCli(): boolean {
  try {
    which.sync('gh');
    return true;
  } catch {
    return false;
  }
}
