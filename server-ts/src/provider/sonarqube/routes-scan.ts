// ---------------------------------------------------------------------------
// SonarQube scan routes
// ---------------------------------------------------------------------------

import { Router, type Request, type Response } from 'express';
import { v4 as uuidv4 } from 'uuid';

import type { AppState } from '../../state.js';
import { ApiError } from '../../errors.js';
import { defaultScanConfig, normalizeScanConfig } from './index.js';
import type { ScanConfig } from './index.js';
import { startScanJob } from './scan.js';

export function sonarqubeScanRoutes(): Router {
  const router = Router();

  router.post('/api/sonarqube/scan', async (req: Request, res: Response) => {
    const state = req.app.locals.state as AppState;
    const body = req.body;
    const scanId = uuidv4();
    const repoId = body.repoId as string;
    const accountId = body.accountId as string;
    const projectKey = body.projectKey as string;
    const bodyResourceId = body.resourceId as string | undefined;

    const repo = state.db.getRepoById(repoId);
    if (!repo) throw ApiError.notFound('Repo not found');

    const account = state.db.getProviderAccount(accountId);
    if (!account) throw ApiError.notFound('Provider account not found');
    const config = JSON.parse(account.config_json);

    const baseUrlVal = config.base_url;
    const tokenVal = config.token;
    if (!baseUrlVal) throw ApiError.badRequest('SonarQube base_url is missing from account config');
    if (!tokenVal) throw ApiError.badRequest('SonarQube token is missing from account config');

    state.db.insertSonarScan(scanId, repoId, accountId, projectKey);

    let resourceId = bodyResourceId && bodyResourceId.trim() !== '' ? bodyResourceId : null;
    if (!resourceId) {
      const bindings = state.db.listProviderBindingsForRepo(repoId);
      const binding = bindings.find(
        (b) => b.provider_id === 'sonarqube' && b.provider_account_id === accountId,
      );
      if (binding) resourceId = binding.provider_resource_id;
    }

    let scanConfig: ScanConfig = defaultScanConfig();
    if (resourceId) {
      const bindingConfig = state.db.getBindingConfig(repoId, accountId, resourceId);
      if (bindingConfig) {
        try {
          scanConfig = normalizeScanConfig(JSON.parse(bindingConfig));
        } catch {
          /* use default */
        }
      }
    }

    startScanJob(state.db, {
      scanId, repoPath: repo.path, projectKey,
      baseUrl: baseUrlVal, token: tokenVal,
      scanConfig, accountId, resourceId,
    });

    return res.json({ id: scanId, status: 'running' });
  });

  router.get('/api/sonarqube/scans/:scanId', (req: Request, res: Response) => {
    const state = req.app.locals.state as AppState;
    const scan = state.db.getSonarScan(req.params.scanId as string);
    if (!scan) throw ApiError.notFound('Scan not found');
    return res.json({ scan });
  });

  router.get('/api/sonarqube/scans', (req: Request, res: Response) => {
    const state = req.app.locals.state as AppState;
    const repoId = String(req.query.repoId ?? '');
    const scans = state.db.listSonarScansByRepo(repoId);
    return res.json({ scans });
  });

  return router;
}
