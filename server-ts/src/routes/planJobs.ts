import { Router, type Request, type Response } from 'express';

import { ApiError } from '../errors.js';
import type { AppState } from '../state.js';
import { planStoreKey } from './shared.js';
import {
  streamSSEBatch,
  streamStoreAsSSE,
  waitForStoreSSE,
} from './sse.js';

export function planJobRoutes(): Router {
  const router = Router();

  // GET /api/plans/jobs/latest - get latest plan job for task
  router.get('/api/plans/jobs/latest', (req: Request, res: Response) => {
    const state = req.app.locals.state as AppState;
    try {
      const taskId = req.query.taskId as string;
      if (!taskId) {
        return ApiError.badRequest('taskId query parameter is required.').toResponse(res);
      }
      const job = state.db.getLatestPlanJobByTask(taskId);
      return res.json({ job });
    } catch (e) {
      if (e instanceof ApiError) return e.toResponse(res);
      return ApiError.internal(e).toResponse(res);
    }
  });

  // GET /api/plans/jobs/:job_id - get plan job by id
  router.get('/api/plans/jobs/:job_id', (req: Request, res: Response) => {
    const state = req.app.locals.state as AppState;
    try {
      const jobId = req.params.job_id as string;
      const job = state.db.getPlanJobById(jobId);
      if (!job) {
        return ApiError.notFound('Plan job not found.').toResponse(res);
      }
      return res.json({ job });
    } catch (e) {
      if (e instanceof ApiError) return e.toResponse(res);
      return ApiError.internal(e).toResponse(res);
    }
  });

  // GET /api/plans/jobs/:job_id/ws - SSE stream for plan job progress
  router.get('/api/plans/jobs/:job_id/ws', (req: Request, res: Response) => {
    const state = req.app.locals.state as AppState;
    try {
      const jobId = req.params.job_id as string;
      const job = state.db.getPlanJobById(jobId);
      if (!job) {
        return ApiError.notFound('Plan job not found.').toResponse(res);
      }

      const storeKey = planStoreKey(jobId);
      const store = state.processManager.getStore(storeKey);

      if (store) {
        return streamStoreAsSSE(res, store);
      }

      if (job.status === 'running' || job.status === 'pending') {
        return waitForStoreSSE(res, state, storeKey, true);
      }

      const messages: string[] = [];
      messages.push(JSON.stringify({
        type: 'db_event',
        data: JSON.stringify({ type: 'status', payload: { message: `Plan job status: ${job.status}` } }),
      }));
      if (job.error) {
        messages.push(JSON.stringify({ type: 'stderr', data: job.error }));
      }
      messages.push(JSON.stringify({
        type: 'finished',
        data: JSON.stringify({ exitCode: job.status === 'done' ? 0 : null, status: job.status }),
      }));

      return streamSSEBatch(res, messages);
    } catch (e) {
      if (e instanceof ApiError) return e.toResponse(res);
      return ApiError.internal(e).toResponse(res);
    }
  });

  return router;
}
