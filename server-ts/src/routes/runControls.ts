import { Router, type Request, type Response } from 'express';

import { ApiError } from '../errors.js';
import { resumeRunInternal } from '../services/runService.js';
import type { AppState } from '../state.js';
import { broadcastGlobalEvent } from '../websocket.js';

export function runControlRoutes(): Router {
  const router = Router();

  // GET /api/runs/active — list all currently running runs with task/repo info
  router.get('/api/runs/active', (req: Request, res: Response) => {
    const state = req.app.locals.state as AppState;
    try {
      const runs = state.db.getActiveRuns();
      return res.json({ runs });
    } catch (e) {
      if (e instanceof ApiError) return e.toResponse(res);
      return ApiError.internal(e).toResponse(res);
    }
  });

  // POST /api/runs/:runId/cancel — cancel a running run (mark as failed)
  router.post('/api/runs/:runId/cancel', async (req: Request, res: Response) => {
    const state = req.app.locals.state as AppState;
    try {
      const runId = req.params.runId as string;
      const run = state.db.getRunById(runId);
      if (!run) return ApiError.notFound('Run not found.').toResponse(res);

      if (run.status !== 'running') {
        return ApiError.badRequest('Run is not currently running.').toResponse(res);
      }

      const cancelled = state.processManager.cancelRun(runId);
      if (!cancelled) {
        return ApiError.badRequest('No running process found for this run.').toResponse(res);
      }

      state.db.updateRunStatus(runId, 'failed', true);
      state.db.updateTaskStatus(run.task_id, 'FAILED');
      state.db.addRunEvent(runId, 'run_cancelled', { reason: 'user_requested' });

      const store = state.processManager.getStore(runId);
      if (store) store.pushFinished(null, 'failed');

      try {
        const task = state.db.getTaskById(run.task_id);
        if (task) {
          broadcastGlobalEvent({
            type: 'run_cancelled',
            runId,
            taskId: run.task_id,
            repoId: task.repo_id,
            taskTitle: task.title,
          });
        }
      } catch {
        // Ignore broadcast failures
      }

      return res.json({ status: 'failed', run_id: runId });
    } catch (e) {
      if (e instanceof ApiError) return e.toResponse(res);
      return ApiError.internal(e).toResponse(res);
    }
  });

  // POST /api/runs/:runId/resume — resume a stopped/failed run by task context
  router.post('/api/runs/:runId/resume', async (req: Request, res: Response) => {
    const state = req.app.locals.state as AppState;
    try {
      const runId = req.params.runId as string;
      const run = state.db.getRunById(runId);
      if (!run) return ApiError.notFound('Run not found.').toResponse(res);

      if (run.status === 'running') {
        return ApiError.badRequest('Run is already running.').toResponse(res);
      }

      const result = await resumeRunInternal(state, {
        taskId: run.task_id,
        profileId: req.body?.profileId,
      });

      return res.status(202).json(result.response);
    } catch (e) {
      if (e instanceof ApiError) return e.toResponse(res);
      return ApiError.internal(e).toResponse(res);
    }
  });

  return router;
}
