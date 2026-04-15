import fs from 'node:fs';
import path from 'node:path';

import { spawnAgent } from '../executor/index.js';
import type { MsgStore } from '../msgStore.js';
import type { ProcessManager } from '../processManager.js';
import type { AppState } from '../state.js';
import { getAppDataDir } from '../routes/shared.js';
import { loadCatalog } from '../mcp/catalog.js';
import { resolveMcpServer } from '../mcp/resolver.js';
import { writeAgentConfig } from '../mcp/configWriter.js';
import type { AgentFlavor } from '../mcp/model.js';

// ---------------------------------------------------------------------------
// MCP helpers (duplicated from runAgent.ts to keep files ≤400 lines each)
// ---------------------------------------------------------------------------

const FLAVOR_KEYWORDS: [string, AgentFlavor][] = [
  ['claude', 'claude'],
  ['codex', 'codex'],
  ['gemini', 'gemini'],
];

function detectFlavor(cmd: string): AgentFlavor | null {
  const lower = cmd.toLowerCase();
  for (const [kw, flavor] of FLAVOR_KEYWORDS) {
    if (lower.includes(kw)) return flavor;
  }
  return null;
}

export function spawnResumeRun(
  agentCommand: string,
  prompt: string,
  agentWorkingDir: string,
  sessionId: string | null,
  runId: string,
  taskId: string,
  repoPath: string,
  baseSha: string | null,
  db: AppState['db'],
  pm: ProcessManager,
  store: MsgStore,
  eventMeta: any,
  state?: AppState,
  agentProfileId?: string,
): void {
  spawnFreshAgent(
    agentCommand, prompt, agentWorkingDir,
    runId, taskId, repoPath, baseSha, db, pm, store, eventMeta,
    sessionId, state, agentProfileId,
  );
}

async function spawnFreshAgent(
  agentCommand: string,
  prompt: string,
  agentWorkingDir: string,
  runId: string,
  taskId: string,
  repoPath: string,
  baseSha: string | null,
  db: AppState['db'],
  pm: ProcessManager,
  store: MsgStore,
  eventMeta: any,
  sessionId: string | null = null,
  state?: AppState,
  agentProfileId?: string,
): Promise<void> {
  let mcpConfigDir: string | null = null;
  try {
    let extraArgs: string[] = [];
    let extraEnv: Record<string, string> = {};

    if (state && agentProfileId) {
      const mcpServers = state.db.listMcpsForProfile(agentProfileId);
      if (mcpServers.length > 0) {
        const flavor = detectFlavor(agentCommand);
        if (flavor) {
          const catalog = await loadCatalog();
          const resolved = await Promise.all(
            mcpServers.map((s) => resolveMcpServer(s, catalog, state.secretStore)),
          );
          mcpConfigDir = path.join(getAppDataDir(), 'agent_configs', runId);
          const emission = await writeAgentConfig(flavor, resolved, mcpConfigDir);
          if (emission.configPath) {
            if (flavor === 'claude') {
              extraArgs = ['--mcp-config', emission.configPath];
            } else if (flavor === 'codex') {
              extraEnv = { CODEX_CONFIG_DIR: path.dirname(emission.configPath) };
            } else if (flavor === 'gemini') {
              extraArgs = ['--settings', emission.configPath];
            }
          }
        }
      }
    }

    const child = spawnAgent(agentCommand, prompt, agentWorkingDir, store, sessionId, extraArgs, extraEnv);
    if (child.pid) {
      db.updateRunPid(runId, child.pid);
    }
    db.addRunEvent(runId, 'agent_spawned', eventMeta);
    pm.attachChild(runId, child);

    if (mcpConfigDir) {
      const dirToRemove = mcpConfigDir;
      child.on('exit', () => {
        fs.promises.rm(dirToRemove, { recursive: true, force: true }).catch(() => {});
      });
    }

    pm.spawnExitMonitor(runId, taskId, repoPath, agentWorkingDir, baseSha, db);
  } catch (e) {
    store.pushStderr(`Failed to spawn agent: ${e}`);
    store.pushFinished(null, 'failed');
    db.addRunEvent(runId, 'run_failed', { error: String(e) });
    db.updateRunStatus(runId, 'failed', true);
  }
}
