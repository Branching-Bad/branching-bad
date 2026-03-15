import type { Db } from './db/index.js';
import { captureDiffWithBase, gitCommitAll } from './executor/index.js';
import type { MsgStore } from './msgStore.js';
import type { ProcessManager } from './processManager.js';
import { buildAgentCommand } from './routes/shared.js';
import { runBuildCommand } from './services/buildRunner.js';
import { attemptBuildRetry } from './services/buildRetry.js';
import { createMemoryFromRun } from './services/memoryService.js';
import { queueAutoApply, enqueueNextQueueTask, scheduleQueueRetry } from './services/queueService.js';
import { broadcastGlobalEvent } from './websocket.js';

/**
 * Handle post-exit cleanup for a child agent process:
 * commit changes, capture diff, update DB status, and notify stream.
 */
export function handleChildExit(
  runId: string,
  taskId: string,
  repoPath: string,
  workingDir: string,
  baseSha: string | null,
  _exitCode: number | null,
  db: Db,
  store: MsgStore | undefined,
  pm?: ProcessManager,
): void {
  let exitCode = _exitCode;
  // Commit any uncommitted changes (use task title for a meaningful commit message)
  try {
    const taskForCommit = db.getTaskById(taskId);
    const commitMsg = taskForCommit
      ? `run #${runId.slice(0, 8)}: ${taskForCommit.title}`
      : 'agent: apply changes';
    gitCommitAll(workingDir, commitMsg);
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

  // Build verification (only on successful agent exit)
  if (exitCode === 0 && store) {
    const task = db.getTaskById(taskId);
    if (task) {
      const buildResult = runBuildCommand(db, task.repo_id, workingDir, store);
      if (buildResult && !buildResult.success) {
        db.addRunEvent(runId, 'build_failed', {
          exitCode: buildResult.exitCode,
          output: buildResult.output.slice(-2000),
        });

        // Attempt retry with build error
        if (pm) {
          const retried = attemptBuildRetry(
            db, pm, store, runId, taskId, repoPath, workingDir, baseSha, buildResult.output,
          );
          if (retried) {
            // Don't mark this run as done/failed yet - retry will handle it
            db.updateRunStatus(runId, 'failed', true);
            db.addRunEvent(runId, 'run_finished', { exitCode: 0, status: 'failed', reason: 'build_failed' });
            return;
          }
          // Max retries exceeded - fall through to mark as failed
          exitCode = 1; // Force failure path
        }
      } else if (buildResult?.success) {
        db.addRunEvent(runId, 'build_passed', {});
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

  // Skip task status update for review runs and conflict resolution runs
  const isConflictResolution = (() => {
    try {
      const events = db.listRunEvents(runId);
      const startEvent = events.find((e) => e.type === 'run_started');
      return startEvent?.payload?.conflictResolution === true;
    } catch { return false; }
  })();

  if (!reviewCommentId && !isConflictResolution) {
    try {
      db.updateTaskStatus(taskId, taskStatus);
    } catch {
      // Ignore
    }

    // Queue mode: auto-apply on success, retry on failure
    try {
      const qTask = db.getTaskById(taskId);
      if (qTask) {
        const qRepo = db.getRepoById(qTask.repo_id);
        if (qRepo?.queue_mode) {
          if (runStatus === 'done') {
            const applied = queueAutoApply(db, taskId, runId);
            if (applied) {
              db.updateTaskStatus(taskId, 'DONE');
            }
            setImmediate(() => enqueueNextQueueTask(db, qTask.repo_id));
          } else {
            scheduleQueueRetry(db, taskId, qTask.repo_id);
          }
        }
      }
    } catch (e) {
      console.error(`Queue processing failed for task ${taskId}:`, e);
    }
  }

  try {
    db.addRunEvent(runId, 'run_finished', { exitCode, status: runStatus });
  } catch {
    // Ignore
  }

  // Create memory from successful runs (async, fire-and-forget)
  if (runStatus === 'done') {
    scheduleMemoryCreation(db, taskId, runId);
  }

  // Broadcast run_finished to global WS subscribers
  try {
    const task = db.getTaskById(taskId);
    if (task) {
      const repo = db.getRepoById(task.repo_id);
      broadcastGlobalEvent({
        type: 'run_finished',
        runId,
        taskId,
        repoId: task.repo_id,
        taskTitle: task.title,
        repoName: repo?.name,
        status: runStatus,
      });
    }
  } catch {
    // Ignore broadcast failures
  }

  // Push finished to message stream
  if (store) {
    store.pushFinished(exitCode, runStatus);
  }
}

function scheduleMemoryCreation(db: Db, taskId: string, runId: string): void {
  setImmediate(async () => {
    try {
      const run = db.getRunById(runId);
      if (!run?.agent_profile_id) return;

      const profile = db.getAgentProfileById(run.agent_profile_id);
      if (!profile) return;

      const task = db.getTaskById(taskId);
      if (!task) return;

      const repo = db.getRepoById(task.repo_id);
      if (!repo) return;

      const agentCommand = buildAgentCommand(profile);
      await createMemoryFromRun(db, taskId, runId, agentCommand, repo.path);
    } catch {
      // Ignore — memory creation is best-effort
    }
  });
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
