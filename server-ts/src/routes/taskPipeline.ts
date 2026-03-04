import { Router, type Request, type Response } from 'express';

import { ApiError } from '../errors.js';
import type { AppState } from '../state.js';
import { isTodoLaneStatus } from './shared.js';

export function taskPipelineRoutes(): Router {
  const router = Router();

  // POST /api/tasks/:task_id/autostart/requeue - requeue autostart
  router.post('/api/tasks/:task_id/autostart/requeue', (req: Request, res: Response) => {
    const state = req.app.locals.state as AppState;
    try {
      const taskId = req.params.task_id as string;

      const task = state.db.getTaskById(taskId);
      if (!task) {
        return ApiError.notFound('Task not found.').toResponse(res);
      }

      if (!isTodoLaneStatus(task.status)) {
        return ApiError.badRequest('Task must be in To Do lane to requeue autostart.').toResponse(res);
      }

      const job = state.db.enqueueAutostartJob(task.id, 'manual_requeue');
      state.db.updateTaskPipelineState(task.id);

      return res.json({ job });
    } catch (e) {
      if (e instanceof ApiError) return e.toResponse(res);
      return ApiError.internal(e).toResponse(res);
    }
  });

  // POST /api/tasks/:task_id/pipeline/clear - clear task pipeline
  router.post('/api/tasks/:task_id/pipeline/clear', (req: Request, res: Response) => {
    const state = req.app.locals.state as AppState;
    try {
      const taskId = req.params.task_id as string;

      const task = state.db.getTaskById(taskId);
      if (!task) {
        return ApiError.notFound('Task not found.').toResponse(res);
      }

      const result = state.db.clearTaskPipeline(taskId);
      return res.json({
        cleared: true,
        plan_jobs_failed: result.plan_jobs_failed,
        autostart_jobs_failed: result.autostart_jobs_failed,
        task_reset: result.task_reset,
      });
    } catch (e) {
      if (e instanceof ApiError) return e.toResponse(res);
      return ApiError.internal(e).toResponse(res);
    }
  });

  // POST /api/pipeline/clear-all - clear all pipelines
  router.post('/api/pipeline/clear-all', (req: Request, res: Response) => {
    const state = req.app.locals.state as AppState;
    try {
      const result = state.db.clearAllPipelines();
      return res.json({
        cleared: true,
        plan_jobs_failed: result.plan_jobs_failed,
        autostart_jobs_failed: result.autostart_jobs_failed,
        task_reset: result.task_reset,
      });
    } catch (e) {
      if (e instanceof ApiError) return e.toResponse(res);
      return ApiError.internal(e).toResponse(res);
    }
  });

  // GET /api/tasks/:task_id/outputs - get live output logs for a task
  router.get('/api/tasks/:task_id/outputs', (req: Request, res: Response) => {
    const state = req.app.locals.state as AppState;
    try {
      const taskId = req.params.task_id as string;
      const outputs = state.db.listTaskOutputs(taskId);
      return res.json({ outputs });
    } catch (e) {
      if (e instanceof ApiError) return e.toResponse(res);
      return ApiError.internal(e).toResponse(res);
    }
  });

  // DELETE /api/tasks/:task_id/outputs - clear output logs for a task
  router.delete('/api/tasks/:task_id/outputs', (req: Request, res: Response) => {
    const state = req.app.locals.state as AppState;
    try {
      const taskId = req.params.task_id as string;
      state.db.clearTaskOutputs(taskId);
      return res.json({ ok: true });
    } catch (e) {
      if (e instanceof ApiError) return e.toResponse(res);
      return ApiError.internal(e).toResponse(res);
    }
  });

  // DELETE /api/outputs - clear all output logs
  router.delete('/api/outputs', (req: Request, res: Response) => {
    const state = req.app.locals.state as AppState;
    try {
      state.db.clearTaskOutputs();
      return res.json({ ok: true });
    } catch (e) {
      if (e instanceof ApiError) return e.toResponse(res);
      return ApiError.internal(e).toResponse(res);
    }
  });

  return router;
}
