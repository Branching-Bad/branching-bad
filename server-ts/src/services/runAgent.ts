// ---------------------------------------------------------------------------
// Background agent spawning for run execution
// ---------------------------------------------------------------------------

import fs from 'node:fs';
import path from 'node:path';

import { MsgStore as MsgStoreClass } from '../msgStore.js';
import {
  createWorktree,
  savePlanArtifact,
  saveTasklistArtifact,
  spawnAgent,
} from '../executor/index.js';
import type { AppState } from '../state.js';
import { getAppDataDir, loadRulesSection } from '../routes/shared.js';
import { startTasklistPoller } from './tasklistTracker.js';
import { loadCatalog } from '../mcp/catalog.js';
import { resolveMcpServer } from '../mcp/resolver.js';
import { writeAgentConfig } from '../mcp/configWriter.js';
import type { AgentFlavor } from '../mcp/model.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SpawnRunAgentParams {
  store: InstanceType<typeof MsgStoreClass>;
  runId: string;
  taskId: string;
  repoPath: string;
  branchName: string;
  baseSha: string | null;
  agentCommand: string;
  agentProfileId: string;
  issueKey: string;
  useWorktree: boolean;
  carryDirtyState: boolean;
  taskTitle: string;
  taskDescription: string | null;
  taskRepoId: string;
  executionPlanMarkdown: string;
  executionPlanVersion: number;
  executionTasklistJson: any;
}

// ---------------------------------------------------------------------------
// Spawn agent in background
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// MCP helpers
// ---------------------------------------------------------------------------

const FLAVOR_KEYWORDS: [string, AgentFlavor][] = [
  ['claude', 'claude'],
  ['codex', 'codex'],
  ['gemini', 'gemini'],
];

function detectFlavor(agentCommand: string): AgentFlavor | null {
  const lower = agentCommand.toLowerCase();
  for (const [kw, flavor] of FLAVOR_KEYWORDS) {
    if (lower.includes(kw)) return flavor;
  }
  return null;
}

async function buildMcpArgs(
  state: AppState,
  agentProfileId: string,
  agentCommand: string,
  runId: string,
): Promise<{ extraArgs: string[]; extraEnv: Record<string, string>; configDir: string | null }> {
  const mcpServers = state.db.listMcpsForProfile(agentProfileId);
  if (mcpServers.length === 0) return { extraArgs: [], extraEnv: {}, configDir: null };

  const flavor = detectFlavor(agentCommand);
  if (!flavor) return { extraArgs: [], extraEnv: {}, configDir: null };

  const catalog = await loadCatalog();
  const resolved = await Promise.all(
    mcpServers.map((s) => resolveMcpServer(s, catalog, state.secretStore)),
  );

  const mcpConfigDir = path.join(getAppDataDir(), 'agent_configs', runId);
  const emission = await writeAgentConfig(flavor, resolved, mcpConfigDir);

  if (!emission.configPath) return { extraArgs: [], extraEnv: {}, configDir: mcpConfigDir };

  const extraArgs: string[] = [];
  const extraEnv: Record<string, string> = {};

  if (flavor === 'claude') {
    extraArgs.push('--mcp-config', emission.configPath);
  } else if (flavor === 'codex') {
    extraEnv['CODEX_CONFIG_DIR'] = path.dirname(emission.configPath);
  } else if (flavor === 'gemini') {
    extraArgs.push('--settings', emission.configPath);
  }

  return { extraArgs, extraEnv, configDir: mcpConfigDir };
}

// ---------------------------------------------------------------------------
// Spawn agent in background
// ---------------------------------------------------------------------------

export function spawnRunAgent(state: AppState, params: SpawnRunAgentParams): void {
  const {
    store, runId, taskId, repoPath, branchName, baseSha,
    agentCommand, agentProfileId, issueKey, useWorktree, carryDirtyState, taskTitle, taskDescription,
    taskRepoId, executionPlanMarkdown, executionPlanVersion, executionTasklistJson,
  } = params;
  const db = state.db;
  const pm = state.processManager;

  setImmediate(async () => {
    let agentWorkingDir: string;

    if (useWorktree) {
      store.push({ type: 'agent_text', data: 'Creating worktree for isolated execution...' });

      try {
        const wtInfo = createWorktree(repoPath, branchName, { carryDirtyState });
        agentWorkingDir = wtInfo.worktreePath;
        db.updateRunWorktreePath(runId, wtInfo.worktreePath);
        store.push({ type: 'agent_text', data: `Worktree ready at: ${wtInfo.worktreePath}` });
      } catch (e) {
        store.pushStderr(`Run failed while creating worktree: ${e}`);
        store.pushFinished(null, 'failed');
        db.addRunEvent(runId, 'run_failed', { error: String(e) });
        db.updateRunStatus(runId, 'failed', true);
        db.updateTaskStatus(taskId, 'FAILED');
        return;
      }
    } else {
      store.push({ type: 'agent_text', data: 'Direct mode: agent will work on current branch.' });
      agentWorkingDir = repoPath;
    }

    // Save plan artifact
    try {
      const artifactPath = savePlanArtifact(
        agentWorkingDir,
        issueKey,
        executionPlanVersion,
        executionPlanMarkdown,
      );
      store.push({ type: 'agent_text', data: `Execution plan saved: ${artifactPath}` });
      db.addRunEvent(runId, 'plan_artifact_saved', { artifactPath });
    } catch {
      store.pushStderr('Run failed: could not save execution plan artifact.');
      store.pushFinished(null, 'failed');
      db.addRunEvent(runId, 'run_failed', { error: 'failed to save plan artifact' });
      db.updateRunStatus(runId, 'failed', true);
      db.updateTaskStatus(taskId, 'FAILED');
      return;
    }

    // Save tasklist with status fields for progress tracking
    let tasklistPath = '';
    try {
      tasklistPath = saveTasklistArtifact(agentWorkingDir, issueKey, executionTasklistJson);
      store.push({ type: 'agent_text', data: `Tasklist saved: ${tasklistPath}` });
    } catch {
      // Non-fatal — progress tracking won't work but agent can still run
    }

    const rulesSection = loadRulesSection(db, taskRepoId);
    const tasklistRelPath = tasklistPath
      ? `.branching-bad/${issueKey}/tasklist.json`
      : '';

    const prompt = [
      `You are working on issue ${issueKey}.`,
      `\nTask: ${taskTitle}`,
      `\nDescription: ${taskDescription ?? 'No description'}`,
      `\nExecution Plan:\n${executionPlanMarkdown}`,
      tasklistRelPath
        ? `\nTasklist file: ${tasklistRelPath}\nRead this file to get the full tasklist with phases, subtasks, dependencies, affected files, and acceptance criteria.`
        : '',
      `\nExecution constraints:`,
      `- Read the tasklist file first, then follow phase order and respect blocked_by dependencies between tasks.`,
      `- Each task has a \`complexity\` (low/medium/high) and \`suggested_model\` field. When delegating subtasks to subagents, use the suggested model tier or an equivalent capability level available to you.`,
      `- If useful, use subagents/tools for parallelizable subtasks while preserving dependencies.`,
      tasklistRelPath
        ? `- MANDATORY — UPDATE TASKLIST BEFORE AND AFTER EVERY STEP: Each task in ${tasklistRelPath} has a "status" field. You MUST update this file before and after every subtask:\n  1. Before starting a subtask: read the file, set that task's status to "in_progress", write it back.\n  2. After completing a subtask: read the file, set that task's status to "completed", write it back.\n  Never skip this step. This is how progress is tracked.`
        : '',
      `- NO DISCOVERY: The plan already contains all the context you need (file paths, function names, logic). Do NOT spend time exploring the codebase, analyzing architecture, or investigating patterns. Start implementing immediately.`,
      `- NO TEST WRITING: Do NOT write unit tests, integration tests, or create test files unless the task description explicitly requests it. Focus only on implementation.`,
      `- BUILD VERIFICATION ONLY: After implementation, verify the build compiles (e.g. tsc --noEmit, npm run build). Do NOT run or create test suites.`,
      `- BULK EDITS: When modifying a file, prefer using the Write tool to rewrite the entire file in one shot instead of multiple Read+Edit cycles. Read a file once to understand it, then Write the complete new version. This is faster and uses fewer tokens. Only use Edit for small, surgical single-line changes.`,
      `- Be concise in your output. Do not narrate what you are about to do — just do it.`,
      rulesSection,
    ].filter(Boolean).join('\n');

    store.push({ type: 'agent_text', data: 'Starting agent process...' });

    let mcpConfigDir: string | null = null;
    try {
      const mcp = await buildMcpArgs(state, agentProfileId, agentCommand, runId);
      mcpConfigDir = mcp.configDir;

      const child = spawnAgent(agentCommand, prompt, agentWorkingDir, store, null, mcp.extraArgs, mcp.extraEnv);

      if (child.pid) {
        db.updateRunPid(runId, child.pid);
      }

      db.addRunEvent(runId, 'agent_spawned', {
        command: agentCommand,
        useWorktree,
        workingDir: agentWorkingDir,
      });

      pm.attachChild(runId, child);

      // Start tasklist progress poller
      if (tasklistPath) {
        const stopPoller = startTasklistPoller(runId, tasklistPath, db, store);
        child.on('exit', () => stopPoller());
      }

      // Clean up per-run MCP config directory on exit
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
      db.updateTaskStatus(taskId, 'FAILED');
    }
  });
}
