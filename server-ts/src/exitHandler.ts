import { existsSync, readFileSync } from 'fs';
import path from 'path';

import type { Db } from './db/index.js';
import { captureDiffWithBase } from './executor/index.js';
import type { MsgStore } from './msgStore.js';
import type { ProcessManager } from './processManager.js';
import { buildAgentCommand } from './routes/shared.js';
import { runBuildCommand } from './services/buildRunner.js';
import { attemptBuildRetry } from './services/buildRetry.js';
import { createMemoryFromRun } from './services/memoryService.js';
import { queueAutoApply, enqueueNextQueueTask, scheduleQueueRetry } from './services/queueService.js';
import { finalizeAfterConflictResolution } from './services/taskLifecycle.js';
import { broadcastGlobalEvent } from './websocket.js';

const CONFLICT_MARKER_RE = /^(<{7,}|={7,}|>{7,}|\|{7,})(\s|$)/m;

function filesStillContainingMarkers(repoPath: string, files: string[]): string[] {
  const remaining: string[] = [];
  for (const rel of files) {
    const abs = path.join(repoPath, rel);
    if (!existsSync(abs)) continue;
    try {
      const content = readFileSync(abs, 'utf-8');
      if (CONFLICT_MARKER_RE.test(content)) {
        remaining.push(rel);
      }
    } catch { /* unreadable — skip */ }
  }
  return remaining;
}

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

  // Identify conflict-resolution runs early — we may need to override exitCode
  // if the agent finished successfully but left conflict markers behind.
  const conflictRunInfo = (() => {
    try {
      const events = db.listRunEvents(runId);
      const startEvent = events.find((e) => e.type === 'run_started');
      if (startEvent?.payload?.conflictResolution !== true) return null;
      const files = startEvent.payload.conflictedFiles;
      return Array.isArray(files) ? (files as string[]) : [];
    } catch { return null; }
  })();

  // Defensive: a conflict-resolution agent that exits 0 but leaves any of the
  // marker tokens in a previously-conflicted file has not actually resolved
  // the conflict. Force a failure so the user sees an error instead of a
  // silently-broken file.
  if (exitCode === 0 && conflictRunInfo && conflictRunInfo.length > 0) {
    const stillConflicted = filesStillContainingMarkers(repoPath, conflictRunInfo);
    if (stillConflicted.length > 0) {
      try {
        db.addRunEvent(runId, 'conflict_unresolved', { files: stillConflicted });
      } catch { /* ignore */ }
      exitCode = 1;
    }
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
  const isConflictResolution = conflictRunInfo !== null;

  // Conflict-resolution success: the agent's resolved tree IS the final state.
  // Auto-finalize the task (worktree+branch cleanup + status=DONE) so the user
  // doesn't have to drag-to-Done again (which would re-run the apply pipeline
  // and re-introduce the same conflict).
  if (isConflictResolution && runStatus === 'done') {
    try {
      finalizeAfterConflictResolution(db, taskId, repoPath);
      db.addRunEvent(runId, 'conflict_resolved_done', {});
    } catch (e) {
      console.error('finalizeAfterConflictResolution failed:', e);
    }
    try {
      broadcastGlobalEvent({
        type: 'task_applied',
        taskId,
        strategy: 'conflict-resolved',
        committed: false,
        filesChanged: conflictRunInfo?.length ?? 0,
      });
    } catch { /* non-fatal */ }
  }

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
