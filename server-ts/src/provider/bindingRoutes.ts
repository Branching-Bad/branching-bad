// ---------------------------------------------------------------------------
// Provider binding + sync routes — bind resources, list bindings, manual sync
// ---------------------------------------------------------------------------

import { Router, type Request, type Response } from 'express';

import { ApiError } from '../errors.js';
import type { AppState } from '../state.js';
import type { ProviderItem } from './index.js';

export function bindingRoutes(): Router {
  const router = Router();

  // ── Bind resource to repo ──

  router.post('/api/providers/:providerId/bind', (req: Request, res: Response) => {
    const state = req.app.locals.state as AppState;
    const providerId = req.params.providerId as string;
    const body = req.body;
    const repoId = body.repoId as string;
    const accountId = body.accountId as string;
    const resourceId = body.resourceId as string;
    const config = body.config ?? {};

    if (!state.db.getRepoById(repoId)) {
      throw ApiError.notFound('Repo not found.');
    }
    if (!state.db.getProviderAccount(accountId)) {
      throw ApiError.notFound('Account not found.');
    }
    if (!state.db.getProviderResource(resourceId)) {
      throw ApiError.notFound('Resource not found.');
    }

    const configJson = JSON.stringify(config);
    const binding = state.db.createProviderBinding(
      repoId, accountId, resourceId, providerId, configJson,
    );
    return res.json({ binding });
  });

  // ── List bindings for a provider + repo ──

  router.get('/api/providers/:providerId/bindings', (req: Request, res: Response) => {
    const state = req.app.locals.state as AppState;
    const providerId = req.params.providerId as string;
    const repoId = String(req.query.repo_id ?? '');

    const allBindings = state.db.listProviderBindingsForRepo(repoId);
    const filtered = allBindings.filter((b) => b.provider_id === providerId);

    const storedResources: Record<string, unknown>[] = [];
    for (const b of filtered) {
      const resources = state.db.listProviderResources(b.provider_account_id);
      for (const r of resources) {
        storedResources.push({
          id: r.id,
          provider_account_id: r.provider_account_id,
          provider_id: r.provider_id,
          external_id: r.external_id,
          name: r.name,
          extra_json: r.extra_json,
          created_at: r.created_at,
          updated_at: r.updated_at,
        });
      }
    }

    return res.json({ bindings: filtered, resources: storedResources });
  });

  // ── Manual sync ──

  router.post('/api/providers/:providerId/sync/:repoId', async (req: Request, res: Response) => {
    const state = req.app.locals.state as AppState;
    const providerId = req.params.providerId as string;
    const repoId = req.params.repoId as string;

    const provider = state.registry.get(providerId);
    if (!provider) throw ApiError.notFound('Provider not found.');

    if (!provider.meta().hasItemsPanel) {
      throw ApiError.badRequest('This provider does not support item sync.');
    }

    const allBindings = state.db.listProviderBindingsForRepo(repoId);
    const bindings = allBindings.filter((b) => b.provider_id === providerId);
    if (bindings.length === 0) {
      throw ApiError.badRequest('No bindings for this provider and repo.');
    }

    let totalSynced = 0;
    const syncErrors: string[] = [];

    for (const binding of bindings) {
      const account = state.db.getProviderAccount(binding.provider_account_id);
      if (!account) {
        syncErrors.push(`Account ${binding.provider_account_id} not found`);
        continue;
      }

      const resource = state.db.getProviderResource(binding.provider_resource_id);
      if (!resource) {
        syncErrors.push(`Resource ${binding.provider_resource_id} not found`);
        continue;
      }

      const config = JSON.parse(account.config_json);
      const since = state.db.getLastProviderSyncTime(account.id, resource.id);

      let items: ProviderItem[];
      try {
        items = await provider.syncItems(config, resource.external_id, since);
      } catch (e: any) {
        syncErrors.push(`Sync ${resource.external_id} failed: ${e.message}`);
        continue;
      }

      if (items.length > 0) {
        const tuples: Array<[string, string, string]> = items.map((i) => [
          i.externalId, i.title, JSON.stringify(i.data),
        ]);
        try {
          totalSynced += state.db.upsertProviderItems(
            account.id, resource.id, providerId, tuples,
          );
        } catch (e: any) {
          syncErrors.push(`DB upsert error: ${e.message}`);
        }
      }
    }

    const updatedItems = state.db.listProviderItems(repoId, providerId, undefined);
    const resp: Record<string, unknown> = { synced: totalSynced, items: updatedItems };
    if (syncErrors.length > 0) {
      resp.errors = syncErrors;
    }
    return res.json(resp);
  });

  return router;
}
