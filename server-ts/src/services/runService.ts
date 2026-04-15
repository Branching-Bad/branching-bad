import fs from 'fs';
import { ApiError } from '../errors.js';
import { MsgStore as MsgStoreClass } from '../msgStore.js';
import { getHeadSha } from '../executor/index.js';
import type { AppState } from '../state.js';
import {
  buildAgentCommand,
  persistStoreOutputs,
} from '../routes/shared.js';
import {
  buildBranchName,
  resolveAgentProfile,
  resolvePlanAndTask,
} from './runHelpers.js';
import { spawnRunAgent } from './runAgent.js';
import { spawnResumeRun } from './agentSpawner.js';
import { broadcastGlobalEvent } from '../websocket.js';

export type { StartRunPayload } from './runHelpers.js';

export interface StartRunResult {
  run: { id: string; status: string; branch_name: string } | null;
  response: any;
}

export async function startRunInternal(
  state: AppState,
  payload: { planId?: string; taskId?: string; profileId?: string; branchName?: string },
): Promise<StartRunResult> {
  const { task, planId, executionPlanMarkdown, executionPlanVersion, executionTasklistJson } =
    resolvePlanAndTask(state, payload);

  const repo = state.db.getRepoById(task.repo_id);
  if (!repo) {
    throw ApiError.notFound('Repo not found.');
  }

  const parallelRunActive = state.db.hasRunningRunForRepo(repo.id);

  const profile = resolveAgentProfile(state, payload, task, repo.id);
  const agentCommand = buildAgentCommand(profile);
  const branchName = buildBranchName(task, profile, payload);
  const baseSha = getHeadSha(repo.path) ?? null;

  const run = state.db.createRun(
    task.id,
    planId,
    'running',
    branchName,
    profile.id,
    undefined,
    baseSha ?? undefined,
  );

  state.db.updateTaskStatus(task.id, 'IN_PROGRESS');

  state.db.addRunEvent(run.id, 'run_started', {
    branchName,
    issueKey: task.jira_issue_key,
    requirePlan: task.require_plan,
    planId,
    planVersion: executionPlanVersion,
    tasklistSchemaVersion: 1,
    agentProfile: {
      id: profile.id,
      provider: profile.provider,
      agentName: profile.agent_name,
      model: profile.model,
      command: agentCommand,
    },
  });

  const response = {
    run: {
      id: run.id,
      status: run.status,
      branch_name: run.branch_name,
      agent: {
        id: profile.id,
        provider: profile.provider,
        agent_name: profile.agent_name,
        model: profile.model,
      },
    },
  };

  broadcastGlobalEvent({
    type: 'run_started',
    runId: run.id,
    taskId: task.id,
    repoId: repo.id,
    taskTitle: task.title,
    repoName: repo.name,
  });

  const store = new MsgStoreClass();
  state.processManager.registerStore(run.id, store);
  persistStoreOutputs(store, state.db, task.id);

  spawnRunAgent(state, {
    store,
    runId: run.id,
    taskId: task.id,
    repoPath: repo.path,
    branchName,
    baseSha,
    agentCommand,
    agentProfileId: profile.id,
    issueKey: task.jira_issue_key,
    useWorktree: task.use_worktree || parallelRunActive,
    carryDirtyState: task.carry_dirty_state,
    taskTitle: task.title,
    taskDescription: task.description,
    taskRepoId: task.repo_id,
    executionPlanMarkdown,
    executionPlanVersion,
    executionTasklistJson,
  });

  return { run: { id: run.id, status: run.status, branch_name: run.branch_name }, response };
}

export async function resumeRunInternal(
  state: AppState,
  payload: { taskId: string; profileId?: string },
): Promise<StartRunResult> {
  const taskId = payload.taskId?.trim();
  if (!taskId) throw ApiError.badRequest('taskId is required.');

  const task = state.db.getTaskById(taskId);
  if (!task) throw ApiError.notFound('Task not found.');

  const repo = state.db.getRepoById(task.repo_id);
  if (!repo) throw ApiError.notFound('Repo not found.');

  const prevRun = state.db.getLatestRunByTask(taskId);
  if (!prevRun?.agent_session_id) {
    throw ApiError.badRequest('No previous session to resume. Use Start Run instead.');
  }

  const profile = resolveAgentProfile(state, payload, task, repo.id);
  const agentCommand = buildAgentCommand(profile);
  const workingDir = (prevRun.worktree_path && fs.existsSync(prevRun.worktree_path))
    ? prevRun.worktree_path : repo.path;
  const baseSha = prevRun.base_sha ?? (getHeadSha(repo.path) ?? null);

  const run = state.db.createRun(
    task.id,
    prevRun.plan_id,
    'running',
    prevRun.branch_name,
    profile.id,
    prevRun.worktree_path ?? undefined,
    baseSha ?? undefined,
  );

  state.db.updateTaskStatus(task.id, 'IN_PROGRESS');

  const response = {
    run: {
      id: run.id, status: run.status, branch_name: run.branch_name,
      agent: { id: profile.id, provider: profile.provider, agent_name: profile.agent_name, model: profile.model },
    },
  };

  broadcastGlobalEvent({
    type: 'run_started',
    runId: run.id,
    taskId: task.id,
    repoId: repo.id,
    taskTitle: task.title,
    repoName: repo.name,
  });

  const store = new MsgStoreClass();
  state.processManager.registerStore(run.id, store);
  persistStoreOutputs(store, state.db, task.id);

  const prompt = 'Continue where you left off. Check the current state and complete the remaining work.';

  spawnResumeRun(
    agentCommand, prompt, workingDir, prevRun.agent_session_id,
    run.id, task.id, repo.path, baseSha,
    state.db, state.processManager, store,
    { command: agentCommand, isResume: true, previousRunId: prevRun.id },
    state, profile.id,
  );

  return { run: { id: run.id, status: run.status, branch_name: run.branch_name }, response };
}
