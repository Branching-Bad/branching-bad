import { Router, type Request, type Response } from 'express';

import { ApiError } from '../../errors.js';
import type { AppState } from '../../state.js';
import { JiraClient } from './client.js';

export function jiraRoutes(): Router {
  const router = Router();

  router.get(
    '/api/providers/jira/accounts/:accountId/resources/:resourceId/sprints',
    async (req: Request, res: Response) => {
      const state = req.app.locals.state as AppState;
      const accountId = String(req.params.accountId ?? '');
      const resourceId = String(req.params.resourceId ?? '');

      const account = state.db.getProviderAccount(accountId);
      if (!account || account.provider_id !== 'jira') {
        throw ApiError.notFound('Jira account not found.');
      }

      const resource = state.db.getProviderResource(resourceId);
      if (!resource || resource.provider_id !== 'jira') {
        throw ApiError.notFound('Jira board not found.');
      }

      if (resource.provider_account_id !== account.id) {
        throw ApiError.badRequest('Board does not belong to the selected Jira account.');
      }

      const config = JSON.parse(account.config_json || '{}');
      const client = new JiraClient(
        String(config.base_url ?? ''),
        String(config.email ?? ''),
        String(config.api_token ?? ''),
      );
      const sprints = await client.fetchBoardSprints(resource.external_id);
      return res.json({ sprints });
    },
  );

  return router;
}
