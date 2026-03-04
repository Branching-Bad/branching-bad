// ---------------------------------------------------------------------------
// Provider account routes — list providers, connect, list/delete accounts,
// list resources
// ---------------------------------------------------------------------------

import { Router, type Request, type Response } from 'express';

import { ApiError } from '../errors.js';
import type { AppState } from '../state.js';

export function accountRoutes(): Router {
  const router = Router();

  // ── List all registered providers ──

  router.get('/api/providers', (req: Request, res: Response) => {
    const state = req.app.locals.state as AppState;
    const metas = state.registry.allMetas();
    return res.json({ providers: metas });
  });

  // ── Connect (validate + upsert account) ──

  router.post('/api/providers/:providerId/connect', async (req: Request, res: Response) => {
    const state = req.app.locals.state as AppState;
    const providerId = req.params.providerId as string;
    const provider = state.registry.get(providerId);
    if (!provider) throw ApiError.notFound('Provider not found.');

    const payload = req.body;
    const result = await provider.validateCredentials(payload);

    const account = state.db.upsertProviderAccount(
      providerId, payload, result.displayName,
    );

    const config = JSON.parse(account.config_json);
    const maskedConfig = provider.maskAccount(config);

    return res.json({
      account: {
        id: account.id,
        providerId: account.provider_id,
        displayName: account.display_name,
        config: maskedConfig,
      },
      extra: result.extra,
    });
  });

  // ── List accounts for a provider ──

  router.get('/api/providers/:providerId/accounts', (req: Request, res: Response) => {
    const state = req.app.locals.state as AppState;
    const providerId = req.params.providerId as string;
    const provider = state.registry.get(providerId);
    if (!provider) throw ApiError.notFound('Provider not found.');

    const accounts = state.db.listProviderAccounts(providerId);
    const masked = accounts.map((a) => {
      const config = JSON.parse(a.config_json);
      const maskedConfig = provider.maskAccount(config);
      return {
        id: a.id,
        providerId: a.provider_id,
        displayName: a.display_name,
        config: maskedConfig,
        createdAt: a.created_at,
        updatedAt: a.updated_at,
      };
    });

    return res.json({ accounts: masked });
  });

  // ── Delete account ──

  router.delete('/api/providers/:providerId/accounts/:id', (req: Request, res: Response) => {
    const state = req.app.locals.state as AppState;
    const providerId = req.params.providerId as string;
    if (!state.registry.get(providerId)) {
      throw ApiError.notFound('Provider not found.');
    }

    state.db.deleteProviderAccount(req.params.id as string);
    return res.json({ deleted: true });
  });

  // ── List resources for an account (fetches from remote + upserts) ──

  router.get('/api/providers/:providerId/accounts/:id/resources', async (req: Request, res: Response) => {
    const state = req.app.locals.state as AppState;
    const providerId = req.params.providerId as string;
    const accountId = req.params.id as string;

    const provider = state.registry.get(providerId);
    if (!provider) throw ApiError.notFound('Provider not found.');

    const account = state.db.getProviderAccount(accountId);
    if (!account) throw ApiError.notFound('Account not found.');

    const config = JSON.parse(account.config_json);
    const resources = await provider.listResources(config);

    const tuples: Array<[string, string, string]> = resources.map((r) => [
      r.externalId, r.name, JSON.stringify(r.extra),
    ]);
    state.db.upsertProviderResources(account.id, providerId, tuples);

    const localResources = state.db.listProviderResources(account.id);
    return res.json({ resources: localResources });
  });

  return router;
}
