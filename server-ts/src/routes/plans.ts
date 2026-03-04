import { Router, type Request, type Response } from 'express';

import { ApiError } from '../errors.js';
import { validateTasklistPayload } from '../planner/index.js';
import { ensurePlanJobRunning } from '../services/planService.js';
import type { AppState } from '../state.js';
import {
  enqueueAutostartIfEnabled,
  resolveAgentCommand,
} from './shared.js';

interface CreatePlanPayload {
  taskId: string;
  revisionComment?: string;
}

interface PlanActionPayload {
  action: string;
  comment?: string;
}

interface ManualPlanRevisionPayload {
  planMarkdown: string;
  tasklistJson: any;
  comment?: string;
}

export function planRoutes(): Router {
  const router = Router();

  // POST /api/plans/create - create plan (manual or generate via agent)
  router.post('/api/plans/create', async (req: Request, res: Response) => {
    const state = req.app.locals.state as AppState;
    try {
      const payload = req.body as CreatePlanPayload;

      const task = state.db.getTaskById(payload.taskId);
      if (!task) {
        return ApiError.notFound('Task not found.').toResponse(res);
      }

      const repo = state.db.getRepoById(task.repo_id);
      if (!repo) {
        return ApiError.badRequest('Task has no valid repo.').toResponse(res);
      }

      const agentCommand = resolveAgentCommand(state, task.repo_id);
      if (!agentCommand) {
        return ApiError.badRequest('Select an AI profile for this repo before plan generation.').toResponse(res);
      }

      const job = await ensurePlanJobRunning(state, task, repo.path, agentCommand, 'manual', payload.revisionComment);
      return res.status(202).json({ job });
    } catch (e) {
      if (e instanceof ApiError) return e.toResponse(res);
      return ApiError.internal(e).toResponse(res);
    }
  });

  // GET /api/plans - list plans for task
  router.get('/api/plans', (req: Request, res: Response) => {
    const state = req.app.locals.state as AppState;
    try {
      const taskId = req.query.taskId as string;
      if (!taskId) {
        return ApiError.badRequest('taskId query parameter is required.').toResponse(res);
      }
      const plans = state.db.listPlansByTask(taskId);
      return res.json({ plans });
    } catch (e) {
      if (e instanceof ApiError) return e.toResponse(res);
      return ApiError.internal(e).toResponse(res);
    }
  });

  // POST /api/plans/:plan_id/action - approve/reject/revise plan
  router.post('/api/plans/:plan_id/action', async (req: Request, res: Response) => {
    const state = req.app.locals.state as AppState;
    try {
      const planId = req.params.plan_id as string;
      const payload = req.body as PlanActionPayload;

      const existingPlan = state.db.getPlanById(planId);
      if (!existingPlan) {
        return ApiError.notFound('Plan not found.').toResponse(res);
      }

      const task = state.db.getTaskById(existingPlan.task_id);
      if (!task) {
        return ApiError.notFound('Task not found.').toResponse(res);
      }

      state.db.addPlanAction(planId, payload.action, payload.comment, 'user');

      switch (payload.action) {
        case 'approve': {
          state.db.updatePlanStatus(planId, 'approved');
          state.db.updateTaskStatus(task.id, 'PLAN_APPROVED');

          const updatedTask = state.db.getTaskById(task.id);
          if (!updatedTask) {
            return ApiError.notFound('Task not found after approval.').toResponse(res);
          }
          enqueueAutostartIfEnabled(state, updatedTask, 'status_to_todo');

          const plan = state.db.getPlanById(planId);
          return res.json({ status: 'approved', plan });
        }

        case 'reject': {
          state.db.updatePlanStatus(planId, 'rejected');
          state.db.updateTaskStatus(task.id, 'To Do');
          const plan = state.db.getPlanById(planId);
          return res.json({ status: 'rejected', plan });
        }

        case 'revise': {
          state.db.updatePlanStatus(planId, 'revise_requested');
          state.db.updateTaskStatus(task.id, 'PLAN_REVISE_REQUESTED');

          const repo = state.db.getRepoById(task.repo_id);
          if (!repo) {
            return ApiError.badRequest('Task repo not found for revision.').toResponse(res);
          }

          const agentCommand = resolveAgentCommand(state, task.repo_id);
          if (!agentCommand) {
            return ApiError.badRequest('Select an AI profile for this repo before plan revision.').toResponse(res);
          }

          const comment = payload.comment ?? 'Please revise this plan.';
          const job = await ensurePlanJobRunning(state, task, repo.path, agentCommand, 'revise', comment);
          return res.status(202).json({ status: 'revising', job });
        }

        default:
          return ApiError.badRequest('Unsupported action. Use approve, reject, or revise.').toResponse(res);
      }
    } catch (e) {
      if (e instanceof ApiError) return e.toResponse(res);
      return ApiError.internal(e).toResponse(res);
    }
  });

  // POST /api/plans/:plan_id/manual-revision - manual plan revision
  router.post('/api/plans/:plan_id/manual-revision', (req: Request, res: Response) => {
    const state = req.app.locals.state as AppState;
    try {
      const planId = req.params.plan_id as string;
      const payload = req.body as ManualPlanRevisionPayload;

      const basePlan = state.db.getPlanById(planId);
      if (!basePlan) {
        return ApiError.notFound('Plan not found.').toResponse(res);
      }

      const task = state.db.getTaskById(basePlan.task_id);
      if (!task) {
        return ApiError.notFound('Task not found.').toResponse(res);
      }

      const targetVersion = state.db.getNextPlanVersion(task.id);
      validateTasklistPayload(payload.tasklistJson, task.jira_issue_key, targetVersion);

      const newPlan = state.db.createPlan(
        task.id,
        'drafted',
        payload.planMarkdown,
        payload.tasklistJson,
        1,
        'manual',
        undefined,
        'user',
      );

      state.db.addPlanAction(newPlan.id, 'manual_revision', payload.comment, 'user');
      state.db.updateTaskStatus(task.id, 'PLAN_DRAFTED');
      state.db.updateTaskPipelineState(task.id);

      const latest = state.db.getPlanById(newPlan.id);
      if (!latest) {
        return ApiError.notFound('Plan not found after manual revision.').toResponse(res);
      }

      return res.json({ plan: latest });
    } catch (e) {
      if (e instanceof ApiError) return e.toResponse(res);
      return ApiError.internal(e).toResponse(res);
    }
  });

  return router;
}
