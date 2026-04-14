import { copyFileSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'fs';
import { spawnSync } from 'child_process';
import path from 'path';

import type { WorktreeInfo } from './types.js';
import { execCommand, execGit } from './shell.js';
import { assertGitRepo } from './git-read.js';
import { worktreesRootFor } from '../routes/shared.js';

// ---------------------------------------------------------------------------
// Worktree management
// ---------------------------------------------------------------------------

/** Create a git worktree under the app data directory, keyed by repo identity. */
export function createWorktree(
  repoPath: string,
  branchName: string,
  options?: { carryDirtyState?: boolean },
): WorktreeInfo {
  assertGitRepo(repoPath);

  const worktreeDir = path.join(worktreesRootFor(repoPath), branchName);
  const parentDir = path.dirname(worktreeDir);
  mkdirSync(parentDir, { recursive: true });

  // Stale leftover from a previous run (crash / orphan / manual interrupt) can
  // leave the directory and/or git's worktree registry pointing at a path that
  // doesn't roundtrip. Clear both before attempting `git worktree add`.
  if (existsSync(worktreeDir)) {
    // Try the proper git removal first so the registry is updated, then fall
    // back to rm + prune for the cases where git no longer recognizes it.
    const gitRemove = execGit(repoPath, ['worktree', 'remove', '--force', worktreeDir]);
    if (!gitRemove.success || existsSync(worktreeDir)) {
      try { rmSync(worktreeDir, { recursive: true, force: true }); } catch { /* best-effort */ }
    }
  }
  // Always prune so a registry entry whose directory has been deleted out of
  // band doesn't block re-creation with the same name.
  execGit(repoPath, ['worktree', 'prune']);

  // Capture dirty state before creating worktree (must happen first)
  let trackedDiff: string | undefined;
  let untrackedFiles: string[] = [];
  if (options?.carryDirtyState) {
    // Combined diff of staged + unstaged for tracked files
    const headDiff = execGit(repoPath, ['diff', '--binary', 'HEAD']);
    if (headDiff.success && headDiff.stdout.trim().length > 0) {
      trackedDiff = headDiff.stdout;
    }
    // List untracked files
    const utResult = execGit(repoPath, ['ls-files', '--others', '--exclude-standard']);
    if (utResult.success) {
      untrackedFiles = utResult.stdout.split('\n').filter((l) => l.trim().length > 0);
    }
  }

  // Try creating with new branch
  const result = execGit(repoPath, ['worktree', 'add', worktreeDir, '-b', branchName]);
  if (!result.success) {
    // Branch might already exist - try without -b
    const result2 = execGit(repoPath, ['worktree', 'add', worktreeDir, branchName]);
    if (!result2.success) {
      throw new Error(`git worktree add failed: ${result2.stderr.trim()}`);
    }
  }

  // Apply dirty state to the new worktree
  if (trackedDiff) {
    const applyResult = spawnSync('git', ['-C', worktreeDir, 'apply', '--allow-empty'], {
      input: trackedDiff,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: process.platform === 'win32',
    });
    if (applyResult.status !== 0) {
      // Non-fatal: log but continue — agent can still work with committed state
      console.warn(`[worktree] Failed to carry dirty state: ${applyResult.stderr?.trim()}`);
    }
  }
  // Copy untracked files
  for (const file of untrackedFiles) {
    const srcPath = path.join(repoPath, file);
    const destPath = path.join(worktreeDir, file);
    try {
      mkdirSync(path.dirname(destPath), { recursive: true });
      copyFileSync(srcPath, destPath);
    } catch {
      // Non-fatal: skip files that can't be copied
    }
  }

  return { worktreePath: worktreeDir };
}

/** Apply dirty state (uncommitted changes + untracked files) from repoPath to an existing worktree. */
export function applyDirtyStateToWorktree(repoPath: string, worktreeDir: string): void {
  const headDiff = execGit(repoPath, ['diff', '--binary', 'HEAD']);
  if (headDiff.success && headDiff.stdout.trim().length > 0) {
    const applyResult = spawnSync('git', ['-C', worktreeDir, 'apply', '--allow-empty'], {
      input: headDiff.stdout,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: process.platform === 'win32',
    });
    if (applyResult.status !== 0) {
      console.warn(`[worktree] Failed to apply dirty state: ${applyResult.stderr?.trim()}`);
    }
  }
  const utResult = execGit(repoPath, ['ls-files', '--others', '--exclude-standard']);
  if (utResult.success) {
    const untrackedFiles = utResult.stdout.split('\n').filter((l) => l.trim().length > 0);
    for (const file of untrackedFiles) {
      const srcPath = path.join(repoPath, file);
      const destPath = path.join(worktreeDir, file);
      try {
        mkdirSync(path.dirname(destPath), { recursive: true });
        copyFileSync(srcPath, destPath);
      } catch {
        // Non-fatal
      }
    }
  }
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

/**
 * Save tasklist JSON with status fields to `.branching-bad/<issueKey>/tasklist.json`.
 * Adds `"status": "pending"` to each task for progress tracking.
 */
export function saveTasklistArtifact(
  repoPath: string,
  issueKey: string,
  tasklistJson: any,
): string {
  const artifactDir = path.join(repoPath, '.branching-bad', issueKey);
  mkdirSync(artifactDir, { recursive: true });

  // Deep clone and inject status fields
  const enriched = JSON.parse(JSON.stringify(tasklistJson));
  for (const phase of enriched.phases ?? []) {
    for (const task of phase.tasks ?? []) {
      if (!task.status) task.status = 'pending';
    }
  }

  const filePath = path.join(artifactDir, 'tasklist.json');
  writeFileSync(filePath, JSON.stringify(enriched, null, 2), 'utf-8');
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
