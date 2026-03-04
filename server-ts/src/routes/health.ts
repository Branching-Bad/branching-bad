import { Router, type Request, type Response } from 'express';

import { ApiError } from '../errors.js';
import type { AppState } from '../state.js';

export function healthRoutes(): Router {
  const router = Router();

  router.get('/api/health', (req: Request, res: Response) => {
    const state = req.app.locals.state as AppState;
    return res.json({ ok: true, dbPath: state.db.dbPathString() });
  });

  router.get('/api/bootstrap', (req: Request, res: Response) => {
    const state = req.app.locals.state as AppState;
    try {
      const repos = state.db.listRepos();
      const agentProfiles = state.db.listAgentProfiles();

      const providerMetas = state.registry.allMetas();
      const providerAccounts: Record<string, unknown[]> = {};

      for (const meta of providerMetas) {
        const accounts = state.db.listProviderAccounts(meta.id);
        const provider = state.registry.get(meta.id);

        const masked = accounts.map((a) => {
          let config: unknown;
          try {
            config = JSON.parse(a.config_json);
          } catch {
            config = null;
          }
          const maskedConfig = provider
            ? provider.maskAccount(config as Record<string, unknown>)
            : config;
          return {
            id: a.id,
            providerId: a.provider_id,
            displayName: a.display_name,
            config: maskedConfig,
            createdAt: a.created_at,
            updatedAt: a.updated_at,
          };
        });

        providerAccounts[meta.id] = masked;
      }

      const providerItemCounts = state.db.countAllPendingProviderItems();
      const countsObj: Record<string, number> = {};
      for (const [key, value] of providerItemCounts) {
        countsObj[key] = value;
      }

      return res.json({
        repos,
        agentProfiles,
        providers: providerMetas,
        providerAccounts,
        providerItemCounts: countsObj,
      });
    } catch (e) {
      if (e instanceof ApiError) return e.toResponse(res);
      return ApiError.internal(e).toResponse(res);
    }
  });

  return router;
}
