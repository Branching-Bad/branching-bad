import { existsSync } from 'fs';
import { Router, type Request, type Response } from 'express';

import { ApiError } from '../errors.js';
import { removeWorktree } from '../executor/index.js';
import { execGit } from '../executor/shell.js';
import type { AppState } from '../state.js';
import { enqueueAutostartIfEnabled, isTodoLaneStatus } from './shared.js';

interface UpdateTaskPayload {
  title?: string;
  description?: string | null;
  priority?: string | null;
  requirePlan?: boolean;
  autoStart?: boolean;
  autoApprovePlan?: boolean;
  useWorktree?: boolean;
  carryDirtyState?: boolean;
  agentProfileId?: string | null;
}

interface UpdateTaskStatusPayload {
  status: string;
}

function resolveNullableField(
  payloadValue: string | null | undefined,
  currentValue: string | null | undefined,
): string | undefined {
  if (payloadValue === null) return undefined;
  if (payloadValue !== undefined) {
    const trimmed = payloadValue.trim();
    return trimmed || undefined;
  }
  return currentValue ?? undefined;
}

export function taskCrudUpdateRoutes(): Router {
  const router = Router();

  // PATCH /api/tasks/:task_id - update task details
  router.patch('/api/tasks/:task_id', (req: Request, res: Response) => {
    const state = req.app.locals.state as AppState;
    try {
      const taskId = req.params.task_id as string;
      const payload = req.body as UpdateTaskPayload;

      const task = state.db.getTaskById(taskId);
      if (!task) {
        return ApiError.notFound('Task not found.').toResponse(res);
      }

      const title = (payload.title?.trim() ?? task.title).trim();
      if (!title) {
        return ApiError.badRequest('Title cannot be empty.').toResponse(res);
      }

      const description = resolveNullableField(payload.description, task.description);
      const priority = resolveNullableField(payload.priority, task.priority);
      const requirePlan = payload.requirePlan ?? task.require_plan;
      const autoApprovePlan = payload.autoApprovePlan ?? task.auto_approve_plan;
      const autoStart = payload.autoStart ?? task.auto_start;
      const useWorktree = payload.useWorktree ?? task.use_worktree;
      const carryDirtyState = payload.carryDirtyState ?? task.carry_dirty_state;
      const agentProfileId = resolveNullableField(payload.agentProfileId, task.agent_profile_id);

      state.db.updateTaskDetails(
        task.id,
        title,
        description,
        priority,
        requirePlan,
        autoStart,
        autoApprovePlan,
        useWorktree,
        carryDirtyState,
        agentProfileId,
      );

      const updated = state.db.getTaskById(task.id);
      if (!updated) {
        return ApiError.notFound('Task not found after update.').toResponse(res);
      }

      const changedAutostartRelated =
        task.auto_start !== updated.auto_start ||
        task.auto_approve_plan !== updated.auto_approve_plan ||
        task.require_plan !== updated.require_plan;

      if (changedAutostartRelated && updated.auto_start && isTodoLaneStatus(updated.status)) {
        enqueueAutostartIfEnabled(state, updated, 'task_updated');
      }

      return res.json({ task: updated });
    } catch (e) {
      if (e instanceof ApiError) return e.toResponse(res);
      return ApiError.internal(e).toResponse(res);
    }
  });

  // PATCH /api/tasks/:task_id/status - update task status
  router.patch('/api/tasks/:task_id/status', (req: Request, res: Response) => {
    const state = req.app.locals.state as AppState;
    try {
      const taskId = req.params.task_id as string;
      const payload = req.body as UpdateTaskStatusPayload;
      const status = payload.status.trim();

      if (!status) {
        return ApiError.badRequest('Status is required.').toResponse(res);
      }

      const task = state.db.getTaskById(taskId);
      if (!task) {
        return ApiError.notFound('Task not found.').toResponse(res);
      }

      state.db.updateTaskStatus(task.id, status);

      // Clean up ALL worktrees + branches when task is archived
      if (status.toUpperCase() === 'ARCHIVED') {
        const repo = state.db.getRepoById(task.repo_id);
        if (repo) {
          const worktreeRuns = state.db.getRunsWithWorktreeByTask(task.id);
          const cleanedBranches = new Set<string>();
          for (const run of worktreeRuns) {
            if (run.worktree_path && existsSync(run.worktree_path)) {
              removeWorktree(repo.path, run.worktree_path);
            }
            if (run.branch_name && !cleanedBranches.has(run.branch_name)) {
              cleanedBranches.add(run.branch_name);
              execGit(repo.path, ['branch', '-D', run.branch_name]);
            }
          }
        }
      }

      const updated = state.db.getTaskById(task.id);
      if (!updated) {
        return ApiError.notFound('Task not found after status update.').toResponse(res);
      }

      if (!isTodoLaneStatus(task.status) && isTodoLaneStatus(updated.status)) {
        enqueueAutostartIfEnabled(state, updated, 'status_to_todo');
      }

      return res.json({ task: updated });
    } catch (e) {
      if (e instanceof ApiError) return e.toResponse(res);
      return ApiError.internal(e).toResponse(res);
    }
  });

  return router;
}
