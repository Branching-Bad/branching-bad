import { Router, type Request, type Response } from 'express';

import { ApiError } from '../errors.js';
import type { AppState } from '../state.js';
import { enqueueAutostartIfEnabled, isTodoLaneStatus } from './shared.js';
import { taskCrudUpdateRoutes } from './taskCrudUpdate.js';

export function taskCrudRoutes(): Router {
  const router = Router();

  // Mount update/status routes from separate module
  router.use(taskCrudUpdateRoutes());

  // GET /api/tasks - list tasks by repo
  router.get('/api/tasks', (req: Request, res: Response) => {
    const state = req.app.locals.state as AppState;
    try {
      const repoId = req.query.repoId as string;
      if (!repoId) {
        return ApiError.badRequest('repoId query parameter is required.').toResponse(res);
      }
      const tasks = state.db.listTasksByRepo(repoId);
      return res.json({ tasks });
    } catch (e) {
      if (e instanceof ApiError) return e.toResponse(res);
      return ApiError.internal(e).toResponse(res);
    }
  });

  // POST /api/tasks - create manual task
  router.post('/api/tasks', (req: Request, res: Response) => {
    const state = req.app.locals.state as AppState;
    try {
      const payload = req.body;
      if (!payload.title || payload.title.trim() === '') {
        return ApiError.badRequest('Title is required.').toResponse(res);
      }

      const repo = state.db.getRepoById(payload.repoId);
      if (!repo) {
        return ApiError.notFound('Repo not found.').toResponse(res);
      }

      const task = state.db.createManualTask(payload);
      if (isTodoLaneStatus(task.status)) {
        enqueueAutostartIfEnabled(state, task, 'task_created');
      }

      return res.json({ task });
    } catch (e) {
      if (e instanceof ApiError) return e.toResponse(res);
      return ApiError.internal(e).toResponse(res);
    }
  });

  // DELETE /api/tasks/:task_id - delete task
  router.delete('/api/tasks/:task_id', (req: Request, res: Response) => {
    const state = req.app.locals.state as AppState;
    try {
      const taskId = req.params.task_id as string;

      const task = state.db.getTaskById(taskId);
      if (!task) {
        return ApiError.notFound('Task not found.').toResponse(res);
      }

      if (!isTodoLaneStatus(task.status)) {
        return ApiError.badRequest('Only tasks in the To Do lane can be deleted.').toResponse(res);
      }

      try {
        state.db.clearTaskPipeline(taskId);
      } catch {
        // Ignore pipeline clear errors
      }

      state.db.deleteTask(taskId);
      return res.json({ deleted: true });
    } catch (e) {
      if (e instanceof ApiError) return e.toResponse(res);
      return ApiError.internal(e).toResponse(res);
    }
  });

  return router;
}
