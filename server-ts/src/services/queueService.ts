import type { Db } from '../db/index.js';
import {
  applyWorktreeToBaseUnstaged,
  applyBranchToBaseUnstaged,
  detectBaseBranchWithDefault,
  gitCommitAll,
} from '../executor/index.js';

/**
 * Auto-apply a completed run's changes to the repo's default branch.
 * Commits but does NOT push.
 */
export function queueAutoApply(db: Db, taskId: string, runId: string): boolean {
  const task = db.getTaskById(taskId);
  if (!task) return false;
  const repo = db.getRepoById(task.repo_id);
  if (!repo) return false;
  const run = db.getRunById(runId);
  if (!run) return false;

  const baseBranch = detectBaseBranchWithDefault(repo.path, repo.default_branch);
  const applyResult = run.worktree_path
    ? applyWorktreeToBaseUnstaged(repo.path, run.branch_name, baseBranch, run.worktree_path)
    : applyBranchToBaseUnstaged(repo.path, run.branch_name, baseBranch);

  if (applyResult.ok && applyResult.result.filesChanged > 0) {
    const label = task.jira_issue_key || task.title;
    const msg = `feat(${label}): ${task.title}`;
    gitCommitAll(repo.path, msg);
  }
  return applyResult.ok === true;
}

/**
 * Enqueue the next TODO task for queue processing.
 */
export function enqueueNextQueueTask(db: Db, repoId: string): void {
  const repo = db.getRepoById(repoId);
  if (!repo?.queue_mode) return;
  if (db.hasRunningRunForRepo(repoId)) return;
  const next = db.getNextQueueTask(repoId);
  if (!next) return;
  db.enqueueAutostartJob(next.id, 'queue_continuation');
}

/**
 * Schedule a retry after 15 minutes for a failed queue task.
 */
export function scheduleQueueRetry(db: Db, taskId: string, repoId: string): void {
  const repo = db.getRepoById(repoId);
  if (!repo?.queue_mode) return;
  setTimeout(() => {
    try {
      const task = db.getTaskById(taskId);
      if (!task) return;
      db.updateTaskStatus(taskId, 'To Do');
      db.enqueueAutostartJob(taskId, 'queue_retry');
    } catch { /* ignore */ }
  }, 15 * 60 * 1000);
}
