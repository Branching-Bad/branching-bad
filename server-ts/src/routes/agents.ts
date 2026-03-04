import { Router, type Request, type Response } from 'express';

import { discoverAgentProfiles } from '../discovery.js';
import { ApiError } from '../errors.js';
import type { AppState } from '../state.js';

export function agentRoutes(): Router {
  const router = Router();

  // GET /api/agents/discover
  router.get('/api/agents/discover', (req: Request, res: Response) => {
    const state = req.app.locals.state as AppState;
    try {
      const discovered = discoverAgentProfiles();
      const synced = state.db.upsertAgentProfiles(discovered);
      const profiles = state.db.listAgentProfiles();
      return res.json({ synced, profiles });
    } catch (e) {
      if (e instanceof ApiError) return e.toResponse(res);
      return ApiError.internal(e).toResponse(res);
    }
  });

  // GET /api/agents
  router.get('/api/agents', (req: Request, res: Response) => {
    const state = req.app.locals.state as AppState;
    try {
      const profiles = state.db.listAgentProfiles();
      return res.json({ profiles });
    } catch (e) {
      if (e instanceof ApiError) return e.toResponse(res);
      return ApiError.internal(e).toResponse(res);
    }
  });

  // POST /api/agents/select
  router.post('/api/agents/select', (req: Request, res: Response) => {
    const state = req.app.locals.state as AppState;
    try {
      const body = req.body as { repoId: string; profileId: string };

      const repo = state.db.getRepoById(body.repoId);
      if (!repo) {
        return ApiError.notFound('Repo not found.').toResponse(res);
      }

      const profile = state.db.getAgentProfileById(body.profileId);
      if (!profile) {
        return ApiError.notFound('Agent profile not found.').toResponse(res);
      }

      const selection = state.db.setRepoAgentPreference(body.repoId, body.profileId);
      return res.json({ selection });
    } catch (e) {
      if (e instanceof ApiError) return e.toResponse(res);
      return ApiError.internal(e).toResponse(res);
    }
  });

  // GET /api/agents/selection
  router.get('/api/agents/selection', (req: Request, res: Response) => {
    const state = req.app.locals.state as AppState;
    try {
      const repoId = req.query.repoId as string;
      if (!repoId) {
        return ApiError.badRequest('repoId query parameter is required.').toResponse(res);
      }

      const selection = state.db.getRepoAgentPreference(repoId);
      return res.json({ selection });
    } catch (e) {
      if (e instanceof ApiError) return e.toResponse(res);
      return ApiError.internal(e).toResponse(res);
    }
  });

  return router;
}
