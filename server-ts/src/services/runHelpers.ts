import { ApiError } from '../errors.js';
import { sanitizeBranchSegment } from '../routes/shared.js';
import type { AppState } from '../state.js';

export interface StartRunPayload {
  planId?: string;
  taskId?: string;
  profileId?: string;
  branchName?: string;
}

export interface ResolvedPlan {
  task: any;
  planId: string;
  executionPlanMarkdown: string;
  executionPlanVersion: number;
  executionTasklistJson: any;
}

export function resolvePlanAndTask(state: AppState, payload: StartRunPayload): ResolvedPlan {
  const providedPlanId = payload.planId?.trim() || undefined;
  const providedTaskId = payload.taskId?.trim() || undefined;

  if (providedPlanId) {
    const plan = state.db.getPlanById(providedPlanId);
    if (!plan) {
      throw ApiError.notFound('Plan not found.');
    }
    const task = state.db.getTaskById(plan.task_id);
    if (!task) {
      throw ApiError.notFound('Task not found.');
    }
    if (task.require_plan && plan.status !== 'approved') {
      throw ApiError.badRequest('Plan must be approved before execution.');
    }
    return {
      task,
      planId: plan.id,
      executionPlanMarkdown: plan.plan_markdown,
      executionPlanVersion: plan.version,
      executionTasklistJson: plan.tasklist,
    };
  }

  if (!providedTaskId) {
    throw ApiError.badRequest('Provide planId or taskId to start a run.');
  }
  const task = state.db.getTaskById(providedTaskId);
  if (!task) {
    throw ApiError.notFound('Task not found.');
  }
  if (task.require_plan) {
    throw ApiError.badRequest('This task requires plan approval before execution.');
  }

  const directPlan = buildDirectExecutionPlan(task);
  const plan = state.db.createPlan(
    task.id,
    'approved',
    directPlan.markdown,
    directPlan.tasklist,
    1,
    'direct_execution',
    undefined,
    'system',
  );

  return {
    task,
    planId: plan.id,
    executionPlanMarkdown: plan.plan_markdown,
    executionPlanVersion: plan.version,
    executionTasklistJson: directPlan.tasklist,
  };
}

function buildDirectExecutionPlan(task: any): { markdown: string; tasklist: any } {
  const markdown = `# Direct Execution\n\nTask: ${task.jira_issue_key} (${task.title})\n\nDescription:\n${task.description ?? 'No description provided.'}\n`;
  const tasklist = {
    schema_version: 1,
    issue_key: task.jira_issue_key,
    generated_from_plan_version: 1,
    phases: [
      {
        id: 'phase-direct',
        name: 'Direct Execution',
        description: 'Single-step direct execution path',
        order: 1,
        tasks: [
          {
            id: 'direct-1',
            title: task.title,
            description: task.description ?? 'No description provided.',
            blocked_by: [],
            blocks: [],
            affected_files: [],
            acceptance_criteria: ['Complete the task and keep changes scoped'],
            suggested_subagent: 'general-purpose',
            estimated_size: 'M',
          },
        ],
      },
    ],
  };
  return { markdown, tasklist };
}

export function resolveAgentProfile(
  state: AppState,
  payload: StartRunPayload,
  task: any,
  repoId: string,
): any {
  const trimmedProfileId = payload.profileId?.trim();

  if (trimmedProfileId) {
    const profile = state.db.getAgentProfileById(trimmedProfileId);
    if (!profile) {
      throw ApiError.badRequest('Selected agent profile no longer exists.');
    }
    state.db.setRepoAgentPreference(repoId, trimmedProfileId);
    return profile;
  }

  if (task.agent_profile_id) {
    const profile = state.db.getAgentProfileById(task.agent_profile_id);
    if (!profile) {
      throw ApiError.badRequest('Task-level agent profile no longer exists.');
    }
    return profile;
  }

  const preference = state.db.getRepoAgentPreference(repoId);
  if (!preference) {
    throw ApiError.badRequest('Select an AI profile for this repo before run.');
  }
  const profile = state.db.getAgentProfileById(preference.agent_profile_id);
  if (!profile) {
    throw ApiError.badRequest('Selected agent profile no longer exists.');
  }
  return profile;
}

export function buildBranchName(task: any, profile: any, payload: StartRunPayload): string {
  if (!task.use_worktree) {
    return '';
  }
  const customBranch = payload.branchName?.trim();
  if (customBranch) {
    return sanitizeBranchSegment(customBranch);
  }
  const agentSegment = sanitizeBranchSegment(profile.provider) || 'agent';
  const taskSegment = sanitizeBranchSegment(task.jira_issue_key) || 'task';
  return `agent/${agentSegment}-${taskSegment}-${Math.floor(Date.now() / 1000)}`;
}
