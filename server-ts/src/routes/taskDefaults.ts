import { Router, type Request, type Response } from 'express';

import { ApiError } from '../errors.js';
import type { AppState } from '../state.js';

export function taskDefaultsRoutes(): Router {
  const router = Router();

  // GET /api/repos/:repoId/task-defaults
  router.get('/api/repos/:repoId/task-defaults', (req: Request, res: Response) => {
    const state = req.app.locals.state as AppState;
    try {
      const repoId = req.params.repoId as string;
      const defaults = state.db.listTaskDefaults(repoId);
      return res.json({ defaults });
    } catch (e) {
      if (e instanceof ApiError) return e.toResponse(res);
      return ApiError.internal(e).toResponse(res);
    }
  });

  // GET /api/repos/:repoId/task-defaults/resolve
  router.get('/api/repos/:repoId/task-defaults/resolve', (req: Request, res: Response) => {
    const state = req.app.locals.state as AppState;
    try {
      const repoId = req.params.repoId as string;
      const providerName = (req.query.provider as string) || null;
      const resolved = state.db.resolveTaskDefaults(repoId, providerName);
      return res.json({ defaults: resolved });
    } catch (e) {
      if (e instanceof ApiError) return e.toResponse(res);
      return ApiError.internal(e).toResponse(res);
    }
  });

  // PUT /api/repos/:repoId/task-defaults
  router.put('/api/repos/:repoId/task-defaults', (req: Request, res: Response) => {
    const state = req.app.locals.state as AppState;
    try {
      const repoId = req.params.repoId as string;
      const body = req.body as {
        providerName?: string;
        requirePlan?: boolean;
        autoStart?: boolean;
        autoApprovePlan?: boolean;
        useWorktree?: boolean;
        carryDirtyState?: boolean;
        priority?: string;
      };
      const providerName = body.providerName ?? null;
      const updated = state.db.upsertTaskDefaults(repoId, providerName, {
        require_plan: body.requirePlan,
        auto_start: body.autoStart,
        auto_approve_plan: body.autoApprovePlan,
        use_worktree: body.useWorktree,
        carry_dirty_state: body.carryDirtyState,
        priority: body.priority,
      });
      return res.json({ defaults: updated });
    } catch (e) {
      if (e instanceof ApiError) return e.toResponse(res);
      return ApiError.internal(e).toResponse(res);
    }
  });

  // DELETE /api/repos/:repoId/task-defaults
  router.delete('/api/repos/:repoId/task-defaults', (req: Request, res: Response) => {
    const state = req.app.locals.state as AppState;
    try {
      const repoId = req.params.repoId as string;
      const providerName = (req.query.provider as string) || null;
      state.db.deleteTaskDefaults(repoId, providerName);
      return res.json({ deleted: true });
    } catch (e) {
      if (e instanceof ApiError) return e.toResponse(res);
      return ApiError.internal(e).toResponse(res);
    }
  });

  return router;
}
