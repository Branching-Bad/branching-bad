// ---------------------------------------------------------------------------
// Background agent spawning for run execution
// ---------------------------------------------------------------------------

import { MsgStore as MsgStoreClass } from '../msgStore.js';
import {
  createWorktree,
  savePlanArtifact,
  saveTasklistArtifact,
  spawnAgent,
} from '../executor/index.js';
import type { AppState } from '../state.js';
import { loadRulesSection } from '../routes/shared.js';
import { startTasklistPoller } from './tasklistTracker.js';

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

      // Start tasklist progress poller
      if (tasklistPath) {
        const stopPoller = startTasklistPoller(runId, tasklistPath, db, store);
        child.on('exit', () => stopPoller());
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
