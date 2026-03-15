import { ApiError } from '../errors.js';
import type { TaskWithPayload } from '../models/task.js';
import { MsgStore } from '../msgStore.js';
import type { AppState } from '../state.js';
import {
  isTodoLaneStatus,
  planStoreKey,
  resolveAgentCommand,
} from './shared.js';
import { spawnPlanGenerationJob } from '../services/planGenerator.js';
import { startRunInternal } from '../services/runService.js';

export async function processAutostartJob(
  state: AppState,
  job: { id: string; task_id: string; trigger_kind: string },
): Promise<void> {
  const forceStart = job.trigger_kind === 'manual_requeue';

  const task = state.db.getTaskById(job.task_id);
  if (!task) {
    state.db.failAutostartJob(job.id, 'task not found');
    return;
  }

  if (!task.auto_start && !forceStart) {
    state.db.completeAutostartJob(job.id);
    return;
  }

  if (!isTodoLaneStatus(task.status) && task.status.trim().toUpperCase() !== 'PLAN_APPROVED') {
    state.db.completeAutostartJob(job.id);
    return;
  }

  const repo = state.db.getRepoById(task.repo_id);
  if (!repo) {
    state.db.failAutostartJob(job.id, 'repo not found');
    return;
  }

  if (state.db.hasRunningRunForRepo(repo.id)) {
    state.db.requeueAutostartJob(job.id, 'repo has active running job, retrying');
    await sleep(500);
    return;
  }

  // Path 1: Task does not require a plan - start run directly
  if (!task.require_plan) {
    try {
      const runResult = await startRunInternal(state, {
        planId: undefined,
        taskId: task.id,
        profileId: undefined,
        branchName: undefined,
      });
      const runId = runResult.run?.id;
      state.db.completeAutostartJob(job.id, undefined, runId);
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) {
        state.db.requeueAutostartJob(job.id, error.message);
      } else {
        const msg = `autostart direct run failed: ${error instanceof Error ? error.message : String(error)}`;
        state.db.updateTaskPipelineState(task.id, msg);
        state.db.failAutostartJob(job.id, msg);
      }
    }
    return;
  }

  // Path 2: Task has an approved plan already - start run with that plan
  if (task.status.trim().toUpperCase() === 'PLAN_APPROVED') {
    const plans = state.db.listPlansByTask(task.id);
    const approvedPlan = plans.find((p) => p.status === 'approved');

    if (approvedPlan) {
      try {
        const runResult = await startRunInternal(state, {
          planId: approvedPlan.id,
          taskId: undefined,
          profileId: undefined,
          branchName: undefined,
        });
        const runId = runResult.run?.id;
        state.db.completeAutostartJob(job.id, approvedPlan.id, runId);
        return;
      } catch (error) {
        if (error instanceof ApiError && error.status === 409) {
          state.db.requeueAutostartJob(job.id, error.message);
          return;
        }
        const msg = `autostart run failed: ${error instanceof Error ? error.message : String(error)}`;
        state.db.updateTaskPipelineState(task.id, msg);
        state.db.failAutostartJob(job.id, msg, approvedPlan.id);
        return;
      }
    }
  }

  // Path 3: Need to generate a plan first
  processAutostartPlanGeneration(state, job, task, repo);
}

function processAutostartPlanGeneration(
  state: AppState,
  job: { id: string; task_id: string },
  task: TaskWithPayload,
  repo: { id: string; path: string },
): void {
  const agentCommand = resolveAgentCommand(state, repo.id);
  if (!agentCommand) {
    const msg = 'auto-start failed: no AI profile selected for repo';
    state.db.updateTaskPipelineState(task.id, msg);
    state.db.failAutostartJob(job.id, msg);
    return;
  }

  state.db.updateTaskStatus(task.id, 'PLAN_GENERATING');
  state.db.updateTaskPipelineState(task.id);

  let planJob;
  try {
    planJob = state.db.createPlanJob(task.id, 'auto_pipeline');
  } catch (error) {
    const msg = `auto pipeline could not create plan job: ${error}`;
    state.db.updateTaskPipelineState(task.id, msg);
    state.db.failAutostartJob(job.id, msg);
    return;
  }

  const storeKey = planStoreKey(planJob.id);
  const hasStore = !!state.processManager.getStore(storeKey);

  if (!hasStore && planJob.status === 'running') {
    state.db.failPlanJob(
      planJob.id,
      'Recovered stale running auto pipeline plan job (missing live process store).',
      planJob.plan_id ?? undefined,
    );
    state.db.updateTaskStatus(task.id, 'To Do');
  }

  const refreshedPlanJob = state.db.getPlanJobById(planJob.id) ?? planJob;

  switch (refreshedPlanJob.status) {
    case 'pending': {
      if (!state.processManager.getStore(planStoreKey(refreshedPlanJob.id))) {
        const store = new MsgStore();
        state.processManager.registerStore(
          planStoreKey(refreshedPlanJob.id),
          store,
        );
        spawnPlanGenerationJob(
          state,
          refreshedPlanJob,
          task,
          repo.path,
          agentCommand,
          'auto_pipeline',
          store,
          job.id,
        );
      }
      break;
    }

    case 'running': {
      if (hasStore) {
        state.db.requeueAutostartJob(
          job.id,
          'plan generation still running, will retry',
        );
      }
      break;
    }

    case 'done':
    case 'failed': {
      state.db.completeAutostartJob(
        job.id,
        refreshedPlanJob.plan_id ?? undefined,
      );
      break;
    }

    default: {
      state.db.requeueAutostartJob(
        job.id,
        `plan job in unexpected state '${refreshedPlanJob.status}', retrying`,
      );
      break;
    }
  }
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
