import type { Db } from './db/index.js';
import { captureDiffWithBase, gitCommitAll } from './executor/index.js';
import type { MsgStore } from './msgStore.js';

/**
 * Handle post-exit cleanup for a child agent process:
 * commit changes, capture diff, update DB status, and notify stream.
 */
export function handleChildExit(
  runId: string,
  taskId: string,
  workingDir: string,
  baseSha: string | null,
  exitCode: number | null,
  db: Db,
  store: MsgStore | undefined,
): void {
  // Commit any uncommitted changes
  try {
    gitCommitAll(workingDir, 'agent: apply changes');
  } catch {
    // Ignore commit failures (no changes, etc.)
  }

  // Capture diff
  let diff = '';
  try {
    diff = captureDiffWithBase(workingDir, baseSha ?? undefined);
  } catch {
    // Ignore diff failures
  }

  if (diff.length > 0) {
    try {
      db.saveRunDiff(runId, diff);
    } catch {
      // Ignore
    }
  }

  try {
    db.addRunEvent(runId, 'working_tree_diff', {
      diffPreview: diff.slice(0, 8000),
    });
  } catch {
    // Ignore
  }

  // Update exit code in DB
  try {
    db.updateRunExitCode(runId, exitCode ?? undefined);
  } catch {
    // Ignore
  }

  // Save session_id from agent stream
  if (store) {
    const sessionId = store.getSessionId();
    if (sessionId) {
      try {
        db.updateRunSessionId(runId, sessionId);
      } catch {
        // Ignore
      }
    }
  }

  // Check if this is a review-triggered run
  let reviewCommentId: string | null = null;
  try {
    const run = db.getRunById(runId);
    if (run) {
      reviewCommentId = run.review_comment_id;
    }
  } catch {
    // Ignore
  }

  // Determine final status
  let runStatus: string;
  let taskStatus: string;

  if (exitCode === 0) {
    runStatus = 'done';
    taskStatus = 'IN_REVIEW';
    if (reviewCommentId) {
      try {
        db.updateReviewCommentStatus(reviewCommentId, 'addressed', runId);
      } catch {
        // Ignore
      }
    }
  } else {
    runStatus = 'failed';
    taskStatus = 'FAILED';
    if (reviewCommentId) {
      try {
        db.updateReviewCommentStatus(reviewCommentId, 'pending', undefined);
      } catch {
        // Ignore
      }
    }
  }

  try {
    db.updateRunStatus(runId, runStatus, true);
  } catch {
    // Ignore
  }

  // Only update task status if not a review run (task stays IN_REVIEW)
  if (!reviewCommentId) {
    try {
      db.updateTaskStatus(taskId, taskStatus);
    } catch {
      // Ignore
    }
  }

  try {
    db.addRunEvent(runId, 'run_finished', { exitCode, status: runStatus });
  } catch {
    // Ignore
  }

  // Push finished to message stream
  if (store) {
    store.pushFinished(exitCode, runStatus);
  }
}

/** Mark any runs left in 'running' state from a previous crash as failed. */
export function recoverOrphans(db: Db): void {
  try {
    db.failStaleRunningRuns();
    console.log('Orphan recovery: checked for stale running runs.');
  } catch (e) {
    console.error('Warning: failed to recover orphaned runs:', e);
  }
}
