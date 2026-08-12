import { Router, type Request, type Response } from 'express';

import { CANONICAL_EFFORTS, discoverAgentProfiles, getProviderCatalog } from '../discovery.js';
import { ApiError } from '../errors.js';
import type { AppState } from '../state.js';

const VALID_EFFORTS = new Set<string>(CANONICAL_EFFORTS);

export function agentRoutes(): Router {
  const router = Router();

  // GET /api/agents/catalog - full provider/model catalog (drives UI dropdowns)
  router.get('/api/agents/catalog', (_req: Request, res: Response) => {
    try {
      return res.json(getProviderCatalog());
    } catch (e) {
      if (e instanceof ApiError) return e.toResponse(res);
      return ApiError.internal(e).toResponse(res);
    }
  });

  // GET /api/agents/discover
  router.get('/api/agents/discover', (req: Request, res: Response) => {
    const state = req.app.locals.state as AppState;
    try {
      const discovered = discoverAgentProfiles();
      const upsertedIds = state.db.upsertAgentProfiles(discovered);
      const pruned = state.db.pruneStaleAgentProfiles(upsertedIds);
      const profiles = state.db.listAgentProfiles();
      return res.json({
        synced: upsertedIds.length,
        pruned,
        profiles,
      });
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

  // POST /api/agents/:profileId/effort - update per-profile canonical effort default
  router.post('/api/agents/:profileId/effort', (req: Request, res: Response) => {
    const state = req.app.locals.state as AppState;
    try {
      const profileId = String(req.params.profileId);
      const body = req.body as { effort?: string | null };
      const raw = body.effort;
      const effort: string | null =
        raw === null || raw === undefined || raw === '' ? null : String(raw);
      if (effort !== null && !VALID_EFFORTS.has(effort)) {
        return ApiError.badRequest(
          `Invalid effort. Allowed: ${[...VALID_EFFORTS].join(', ')}`,
        ).toResponse(res);
      }
      const profile = state.db.getAgentProfileById(profileId);
      if (!profile) return ApiError.notFound('Agent profile not found.').toResponse(res);
      state.db.setAgentProfileEffortDefault(profileId, effort);
      const updated = state.db.getAgentProfileById(profileId);
      return res.json({ profile: updated });
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
