import type { Db } from '../db/index.js';
import type { MsgStore } from '../msgStore.js';
import type { ProcessManager } from '../processManager.js';
import { buildAgentCommand } from '../routes/shared.js';
import { spawnResumeRun } from './agentSpawner.js';

const MAX_BUILD_RETRIES = 2;

/**
 * Count how many build_retry events exist for runs of this task.
 */
function countBuildRetries(db: Db, taskId: string): number {
  const db_ = db.connect();
  const row = db_.prepare(
    `SELECT COUNT(*) as cnt FROM events
     WHERE type = 'build_retry'
     AND run_id IN (SELECT id FROM runs WHERE task_id = ?)`,
  ).get(taskId) as any;
  return row?.cnt ?? 0;
}

/**
 * Attempt a build-fix retry: spawn a new agent run with the build error as prompt.
 * Returns true if retry was spawned, false if max retries exceeded.
 */
export function attemptBuildRetry(
  db: Db,
  pm: ProcessManager,
  store: MsgStore,
  runId: string,
  taskId: string,
  repoPath: string,
  workingDir: string,
  baseSha: string | null,
  buildOutput: string,
): boolean {
  const retryCount = countBuildRetries(db, taskId);
  if (retryCount >= MAX_BUILD_RETRIES) {
    store.push({ type: 'stderr', data: `[build] Max retries (${MAX_BUILD_RETRIES}) reached, marking as failed` });
    return false;
  }

  const run = db.getRunById(runId);
  if (!run?.agent_profile_id) return false;

  const profile = db.getAgentProfileById(run.agent_profile_id);
  if (!profile) return false;

  const agentCommand = buildAgentCommand(profile);
  const sessionId = run.agent_session_id;

  const prompt = `The build command failed after your changes. Fix the build errors and try again.

Build output:
${buildOutput.slice(-3000)}

Fix the issues so the build passes.`;

  const newRun = db.createRun(
    taskId,
    run.plan_id,
    'running',
    run.branch_name,
    run.agent_profile_id,
    workingDir,
    baseSha ?? undefined,
  );

  db.addRunEvent(runId, 'build_retry', { retryCount: retryCount + 1, newRunId: newRun.id });

  store.push({ type: 'stdout', data: `[build] Spawning retry ${retryCount + 1}/${MAX_BUILD_RETRIES}...` });

  spawnResumeRun(
    agentCommand, prompt, workingDir, sessionId,
    newRun.id, taskId, repoPath, baseSha,
    db, pm, store,
    { command: agentCommand, isBuildRetry: true, retryCount: retryCount + 1 },
  );

  return true;
}
