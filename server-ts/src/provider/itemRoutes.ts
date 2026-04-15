// ---------------------------------------------------------------------------
// Provider item routes — list, action, clear, event detail, create task
// ---------------------------------------------------------------------------

import { Router, type Request, type Response } from 'express';

import { ApiError } from '../errors.js';
import type { AppState } from '../state.js';
import type { ProviderItem } from './index.js';
import { SentryClient } from './sentry/client.js';

export function itemRoutes(): Router {
  const router = Router();

  // ── Pending item counts, grouped by provider, for a given repo ──

  router.get('/api/providers/item-counts', (req: Request, res: Response) => {
    const state = req.app.locals.state as AppState;
    const repoId = (req.query.repoId as string | undefined)?.trim();
    if (!repoId) {
      return res.json({ counts: {} });
    }
    const counts = state.db.countPendingProviderItemsForRepo(repoId);
    const countsObj: Record<string, number> = {};
    for (const [k, v] of counts) countsObj[k] = v;
    return res.json({ counts: countsObj });
  });

  // ── List items for a provider + repo ──

  router.get('/api/providers/:providerId/items/:repoId', (req: Request, res: Response) => {
    const state = req.app.locals.state as AppState;
    const providerId = req.params.providerId as string;
    const repoId = req.params.repoId as string;
    const status = req.query.status as string;

    const items = state.db.listProviderItems(repoId, providerId, status);
    return res.json({ items });
  });

  // ── Item action (ignore / restore) ──

  router.post('/api/providers/:providerId/items/:id/action', (req: Request, res: Response) => {
    const state = req.app.locals.state as AppState;
    const itemId = req.params.id as string;
    const body = req.body;
    const action = body.action as string;

    const item = state.db.getProviderItem(itemId);
    if (!item) throw ApiError.notFound('Item not found.');

    switch (action) {
      case 'ignore':
        state.db.updateProviderItemStatus(item.id, 'ignored');
        return res.json({ status: 'ignored' });
      case 'restore':
        state.db.updateProviderItemStatus(item.id, 'pending');
        return res.json({ status: 'pending' });
      default:
        throw ApiError.badRequest("Unsupported action. Use 'ignore' or 'restore'.");
    }
  });

  // ── Clear all items for a provider + repo ──

  router.post('/api/providers/:providerId/items/clear/:repoId', (req: Request, res: Response) => {
    const state = req.app.locals.state as AppState;
    const providerId = req.params.providerId as string;
    const repoId = req.params.repoId as string;
    const deleted = state.db.deleteProviderItemsForRepo(providerId, repoId);
    return res.json({ deleted });
  });

  // ── Fetch latest Sentry event for an item ──

  router.get('/api/providers/:providerId/items/:id/event', async (req: Request, res: Response) => {
    const state = req.app.locals.state as AppState;
    const providerId = req.params.providerId as string;
    if (providerId !== 'sentry') {
      throw ApiError.badRequest('Event detail is only supported for Sentry items.');
    }
    const itemId = req.params.id as string;

    const item = state.db.getProviderItem(itemId);
    if (!item) throw ApiError.notFound('Item not found.');

    const account = state.db.getProviderAccount(item.provider_account_id);
    if (!account) throw ApiError.notFound('Provider account not found.');

    const config = JSON.parse(account.config_json);
    const client = new SentryClient(
      String(config.base_url ?? ''),
      String(config.org_slug ?? ''),
      String(config.auth_token ?? ''),
    );
    const event = await client.fetchLatestEvent(item.external_id);
    return res.json({ event });
  });

  // ── Create task from provider item ──

  router.post('/api/providers/:providerId/items/:id/create-task', (req: Request, res: Response) => {
    const state = req.app.locals.state as AppState;
    const providerId = req.params.providerId as string;
    const itemId = req.params.id as string;

    const provider = state.registry.get(providerId);
    if (!provider) throw ApiError.notFound('Provider not found.');

    const item = state.db.getProviderItem(itemId);
    if (!item) throw ApiError.notFound('Item not found.');

    if (item.linked_task_id && item.status !== 'regression') {
      throw ApiError.badRequest('This item already has a linked task.');
    }

    const bindings = state.db.listProviderBindings(providerId);
    const binding = bindings.find(
      (b) =>
        b.provider_account_id === item.provider_account_id &&
        b.provider_resource_id === item.provider_resource_id,
    );
    if (!binding) {
      throw ApiError.badRequest('No repo binding found for this item.');
    }

    const data = JSON.parse(item.data_json);
    const providerItem: ProviderItem = {
      externalId: item.external_id,
      title: item.title,
      data,
    };

    const fields = provider.itemToTaskFields(providerItem);

    const task = state.db.createManualTask({
      repoId: binding.repo_id,
      title: fields.title,
      description: fields.description ?? undefined,
      status: 'To Do',
      priority: 'High',
      requirePlan: fields.requirePlan,
      autoStart: fields.autoStart,
      autoApprovePlan: false,
      useWorktree: true,
    });

    state.db.linkProviderItemToTask(item.id, task.id);

    return res.json({ task, itemId: item.id });
  });

  return router;
}
