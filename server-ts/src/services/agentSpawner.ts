import type { Db } from '../db/index.js';
import { spawnAgent } from '../executor/index.js';
import type { MsgStore } from '../msgStore.js';
import type { ProcessManager } from '../processManager.js';

export function spawnResumeRun(
  agentCommand: string,
  prompt: string,
  agentWorkingDir: string,
  sessionId: string | null,
  runId: string,
  taskId: string,
  repoPath: string,
  baseSha: string | null,
  db: Db,
  pm: ProcessManager,
  store: MsgStore,
  eventMeta: any,
): void {
  spawnFreshAgent(
    agentCommand, prompt, agentWorkingDir,
    runId, taskId, repoPath, baseSha, db, pm, store, eventMeta,
    sessionId,
  );
}

function spawnFreshAgent(
  agentCommand: string,
  prompt: string,
  agentWorkingDir: string,
  runId: string,
  taskId: string,
  repoPath: string,
  baseSha: string | null,
  db: Db,
  pm: ProcessManager,
  store: MsgStore,
  eventMeta: any,
  sessionId: string | null = null,
): void {
  try {
    const child = spawnAgent(agentCommand, prompt, agentWorkingDir, store, sessionId);
    if (child.pid) {
      db.updateRunPid(runId, child.pid);
    }
    db.addRunEvent(runId, 'agent_spawned', eventMeta);
    pm.attachChild(runId, child);
    pm.spawnExitMonitor(runId, taskId, repoPath, agentWorkingDir, baseSha, db);
  } catch (e) {
    store.pushStderr(`Failed to spawn agent: ${e}`);
    store.pushFinished(null, 'failed');
    db.addRunEvent(runId, 'run_failed', { error: String(e) });
    db.updateRunStatus(runId, 'failed', true);
  }
}
