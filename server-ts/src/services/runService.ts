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

  if (state.db.hasRunningRunForRepo(repo.id)) {
    throw ApiError.conflict(
      'Another run is already active for this repository. Wait for it to finish.',
    );
  }

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
    issueKey: task.jira_issue_key,
    useWorktree: task.use_worktree,
    taskTitle: task.title,
    taskDescription: task.description,
    taskRepoId: task.repo_id,
    executionPlanMarkdown,
    executionPlanVersion,
    executionTasklistJson,
  });

  return { run: { id: run.id, status: run.status, branch_name: run.branch_name }, response };
}
