import { mkdirSync, rmSync, writeFileSync } from 'fs';
import path from 'path';

import type { WorktreeInfo } from './types.js';
import { execCommand, execGit } from './shell.js';
import { assertGitRepo } from './git-read.js';

// ---------------------------------------------------------------------------
// Worktree management
// ---------------------------------------------------------------------------

/** Create a git worktree at `.branching-bad/worktrees/<branchName>/`. */
export function createWorktree(repoPath: string, branchName: string): WorktreeInfo {
  assertGitRepo(repoPath);

  const worktreeDir = path.join(repoPath, '.branching-bad', 'worktrees', branchName);
  const parentDir = path.dirname(worktreeDir);
  mkdirSync(parentDir, { recursive: true });

  // Try creating with new branch
  const result = execGit(repoPath, ['worktree', 'add', worktreeDir, '-b', branchName]);
  if (!result.success) {
    // Branch might already exist - try without -b
    const result2 = execGit(repoPath, ['worktree', 'add', worktreeDir, branchName]);
    if (!result2.success) {
      throw new Error(`git worktree add failed: ${result2.stderr.trim()}`);
    }
  }

  return { worktreePath: worktreeDir };
}

/** Remove a git worktree, with fallback to manual cleanup. */
export function removeWorktree(repoPath: string, worktreePath: string): void {
  const result = execGit(repoPath, ['worktree', 'remove', worktreePath, '--force']);
  if (!result.success) {
    try {
      rmSync(worktreePath, { recursive: true, force: true });
    } catch {
      // ignore cleanup failure
    }
    execGit(repoPath, ['worktree', 'prune']);
  }
}

// ---------------------------------------------------------------------------
// Plan artifacts
// ---------------------------------------------------------------------------

/** Save a plan markdown file to `.branching-bad/<issueKey>/approved-plan-v<version>.md`. */
export function savePlanArtifact(
  repoPath: string,
  issueKey: string,
  version: number,
  markdown: string,
): string {
  const artifactDir = path.join(repoPath, '.branching-bad', issueKey);
  mkdirSync(artifactDir, { recursive: true });
  const filePath = path.join(artifactDir, `approved-plan-v${version}.md`);
  writeFileSync(filePath, markdown, 'utf-8');
  return filePath;
}

// ---------------------------------------------------------------------------
// Commit, push, PR
// ---------------------------------------------------------------------------

/** Stage all changes and commit. */
export function gitCommitAll(repoPath: string, message: string): string {
  const add = execGit(repoPath, ['add', '-A']);
  if (!add.success) {
    throw new Error(`git add failed: ${add.stderr.trim()}`);
  }

  const commit = execGit(repoPath, ['commit', '-m', message]);
  if (!commit.success) {
    if (commit.stderr.includes('nothing to commit')) {
      return 'nothing to commit';
    }
    throw new Error(`git commit failed: ${commit.stderr.trim()}`);
  }
  return commit.stdout.trim();
}

/** Push a branch to origin. */
export function gitPush(repoPath: string, branch: string): string {
  const result = execGit(repoPath, ['push', 'origin', branch]);
  if (!result.success) {
    throw new Error(`git push failed: ${result.stderr.trim()}`);
  }
  return result.stderr.trim();
}

/** Create a PR using the `gh` CLI. Returns the PR URL. */
export function ghCreatePr(
  repoPath: string,
  title: string,
  body: string,
  baseBranch: string,
): string {
  const result = execCommand(
    'gh',
    ['pr', 'create', '--title', title, '--body', body, '--base', baseBranch],
    { cwd: repoPath },
  );
  if (!result.success) {
    throw new Error(`gh pr create failed: ${result.stderr.trim()}`);
  }
  return result.stdout.trim();
}
