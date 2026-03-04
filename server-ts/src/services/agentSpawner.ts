import type { Db } from '../db/index.js';
import {
  spawnAgent,
  splitCommand,
  parseClaudeStreamJson,
} from '../executor/index.js';
import type { MsgStore } from '../msgStore.js';
import type { ProcessManager } from '../processManager.js';

export async function spawnResumeRun(
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
): Promise<void> {
  const agentKind = agentCommand.toLowerCase().includes('claude') ? 'claude' : 'other';

  if (agentKind === 'claude' && sessionId) {
    await spawnClaudeResumeSession(
      agentCommand, prompt, agentWorkingDir, sessionId,
      runId, taskId, repoPath, baseSha, db, pm, store, eventMeta,
    );
  } else {
    spawnFreshAgent(
      agentCommand, prompt, agentWorkingDir,
      runId, taskId, repoPath, baseSha, db, pm, store, eventMeta,
    );
  }
}

async function spawnClaudeResumeSession(
  agentCommand: string,
  prompt: string,
  agentWorkingDir: string,
  sessionId: string,
  runId: string,
  taskId: string,
  repoPath: string,
  baseSha: string | null,
  db: Db,
  pm: ProcessManager,
  store: MsgStore,
  eventMeta: any,
): Promise<void> {
  let parts: string[];
  try {
    parts = splitCommand(agentCommand);
  } catch (e) {
    store.pushStderr(`Invalid agent command: ${e}`);
    store.pushFinished(null, 'failed');
    db.addRunEvent(runId, 'run_failed', { error: String(e) });
    db.updateRunStatus(runId, 'failed', true);
    return;
  }

  if (parts.length === 0) {
    store.pushStderr('Empty agent command');
    store.pushFinished(null, 'failed');
    db.addRunEvent(runId, 'run_failed', { error: 'empty agent command' });
    db.updateRunStatus(runId, 'failed', true);
    return;
  }

  const { spawn } = await import('child_process');
  const { createInterface } = await import('readline');

  const [bin, ...extraArgs] = parts;
  const args = [
    ...extraArgs,
    '--resume',
    sessionId,
    '-p',
    prompt,
    '--permission-mode',
    'bypassPermissions',
    '--dangerously-skip-permissions',
    '--output-format',
    'stream-json',
    '--verbose',
  ];

  const env = { ...process.env };
  delete env['CLAUDECODE'];
  delete env['CLAUDE_CODE_ENTRYPOINT'];

  try {
    const child = spawn(bin, args, {
      cwd: agentWorkingDir,
      stdio: ['pipe', 'pipe', 'pipe'],
      env,
      shell: process.platform === 'win32',
    });

    if (child.stdin) {
      child.stdin.end();
    }

    if (child.stdout) {
      const rl = createInterface({ input: child.stdout });
      rl.on('line', (line: string) => {
        const parsed = parseClaudeStreamJson(line);
        if (parsed) {
          if (parsed.sessionId) {
            store.setSessionId(parsed.sessionId);
          }
          store.push(parsed.msg);
          return;
        }
        store.pushStdout(line);
      });
    }

    if (child.stderr) {
      const rl = createInterface({ input: child.stderr });
      rl.on('line', (line: string) => {
        store.pushStderr(line);
      });
    }

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
): void {
  try {
    const child = spawnAgent(agentCommand, prompt, agentWorkingDir, store);
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
