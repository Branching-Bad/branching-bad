// ---------------------------------------------------------------------------
// Task lifecycle helpers — Done transition with auto apply-to-main + cleanup
// ---------------------------------------------------------------------------

import { existsSync } from 'fs';

import type { Db } from '../db/index.js';
import { removeWorktree } from '../executor/index.js';
import { execGit } from '../executor/shell.js';
import type { AppState } from '../state.js';
import { applyToMain } from './mergeService.js';

export type DoneTransitionResult =
  | { ok: true }
  | { ok: false; conflict: true; conflictedFiles: string[] };

/**
 * Finalize a task moving to DONE:
 *   1. If the task uses a worktree, apply its changes to main as unstaged (no commit).
 *   2. On conflict, abort and surface the conflicted files for the UI modal.
 *   3. On success, delete the worktree and its branch.
 *
 * Direct-mode tasks (use_worktree=false) short-circuit: changes are already in main.
 */
export function finalizeTaskDone(state: AppState, taskId: string): DoneTransitionResult {
  const task = state.db.getTaskById(taskId);
  if (!task) return { ok: true };

  if (task.use_worktree) {
    const applyResult = applyToMain(state, taskId, { strategy: 'squash', autoCommit: false });
    if (applyResult && applyResult.conflict) {
      return {
        ok: false,
        conflict: true,
        conflictedFiles: applyResult.conflictedFiles ?? [],
      };
    }
  }

  const repo = state.db.getRepoById(task.repo_id);
  if (repo) {
    cleanupTaskWorktrees(state, taskId, repo.path);
  }

  return { ok: true };
}

/** Remove every worktree and branch associated with a task. Best-effort. */
export function cleanupTaskWorktrees(state: AppState, taskId: string, repoPath: string): void {
  cleanupTaskWorktreesDb(state.db, taskId, repoPath);
}

/** Same as cleanupTaskWorktrees but takes a Db handle directly (for callers
 * that don't have the full AppState, e.g. exitHandler). */
export function cleanupTaskWorktreesDb(db: Db, taskId: string, repoPath: string): void {
  const worktreeRuns = db.getRunsWithWorktreeByTask(taskId);
  const seenBranches = new Set<string>();
  for (const run of worktreeRuns) {
    if (run.worktree_path && existsSync(run.worktree_path)) {
      try { removeWorktree(repoPath, run.worktree_path); } catch { /* non-fatal */ }
    }
    if (run.branch_name && !seenBranches.has(run.branch_name)) {
      seenBranches.add(run.branch_name);
      try { execGit(repoPath, ['branch', '-D', run.branch_name]); } catch { /* non-fatal */ }
    }
  }
}

/**
 * After a conflict-resolution agent finishes successfully (no markers remain),
 * the agent's resolved content IS the final state of main. Don't re-apply the
 * worktree patch — that just causes duplicate-insertion conflicts. Instead:
 *   1. Clean up the task's worktree + branch.
 *   2. Mark the task DONE.
 */
export function finalizeAfterConflictResolution(
  db: Db,
  taskId: string,
  repoPath: string,
): void {
  cleanupTaskWorktreesDb(db, taskId, repoPath);
  try { db.updateTaskStatus(taskId, 'DONE'); } catch { /* non-fatal */ }
}
