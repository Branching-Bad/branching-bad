// ---------------------------------------------------------------------------
// Background agent spawning for run execution
// ---------------------------------------------------------------------------

import { MsgStore as MsgStoreClass } from '../msgStore.js';
import {
  createWorktree,
  savePlanArtifact,
  spawnAgent,
} from '../executor/index.js';
import type { AppState } from '../state.js';
import { loadRulesSection } from '../routes/shared.js';

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
  issueKey: string;
  useWorktree: boolean;
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

export function spawnRunAgent(state: AppState, params: SpawnRunAgentParams): void {
  const {
    store, runId, taskId, repoPath, branchName, baseSha,
    agentCommand, issueKey, useWorktree, taskTitle, taskDescription,
    taskRepoId, executionPlanMarkdown, executionPlanVersion, executionTasklistJson,
  } = params;
  const db = state.db;
  const pm = state.processManager;

  setImmediate(async () => {
    let agentWorkingDir: string;

    if (useWorktree) {
      store.push({ type: 'agent_text', data: 'Creating worktree for isolated execution...' });

      try {
        const wtInfo = createWorktree(repoPath, branchName);
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

    const rulesSection = loadRulesSection(db, taskRepoId);
    const tasklistPretty = JSON.stringify(executionTasklistJson, null, 2);
    const prompt = `You are working on issue ${issueKey}.\n\nTask: ${taskTitle}\n\nDescription: ${taskDescription ?? 'No description'}\n\nExecution Plan:\n${executionPlanMarkdown}\n\nTasklist JSON:\n${tasklistPretty}\n\nExecution constraints:\n- Follow phase order and respect blocked_by dependencies between tasks.\n- Report progress using task IDs from tasklist.\n- Each task has a \`complexity\` (low/medium/high) and \`suggested_model\` field. When delegating subtasks to subagents, use the suggested model tier or an equivalent capability level available to you. Low complexity tasks should use the fastest/cheapest model, high complexity tasks should use the most capable model.\n- If useful, use subagents/tools for parallelizable subtasks while preserving dependencies.\n- NO DISCOVERY: The plan already contains all the context you need (file paths, function names, logic). Do NOT spend time exploring the codebase, analyzing architecture, or investigating patterns. Start implementing immediately.\n- NO TEST WRITING: Do NOT write unit tests, integration tests, or create test files unless the task description explicitly requests it. Focus only on implementation.\n- BUILD VERIFICATION ONLY: After implementation, verify the build compiles (e.g. tsc --noEmit, npm run build). Do NOT run or create test suites.\n- BULK EDITS: When modifying a file, prefer using the Write tool to rewrite the entire file in one shot instead of multiple Read+Edit cycles. Read a file once to understand it, then Write the complete new version. This is faster and uses fewer tokens. Only use Edit for small, surgical single-line changes.\n- Be concise in your output. Do not narrate what you are about to do — just do it.${rulesSection}`;

    store.push({ type: 'agent_text', data: 'Starting agent process...' });

    try {
      const child = spawnAgent(agentCommand, prompt, agentWorkingDir, store);

      if (child.pid) {
        db.updateRunPid(runId, child.pid);
      }

      db.addRunEvent(runId, 'agent_spawned', {
        command: agentCommand,
        useWorktree,
        workingDir: agentWorkingDir,
      });

      pm.attachChild(runId, child);
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
