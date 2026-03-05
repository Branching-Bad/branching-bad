// ---------------------------------------------------------------------------
// SonarQube setup and configuration routes
// ---------------------------------------------------------------------------

import { Router, type Request, type Response } from 'express';

import type { AppState } from '../../state.js';
import { ApiError } from '../../errors.js';
import {
  SonarClient,
  checkDockerAvailable,
  defaultScanConfig,
  normalizeScanConfig,
  getSonarqubeContainerStatus,
  DEFAULT_EXCLUSIONS,
} from './index.js';
import type { ScanConfig } from './index.js';
import { startSetupJob } from './setup.js';
import { sonarqubeScanRoutes } from './routes-scan.js';

export function sonarqubeRoutes(): Router {
  const router = Router();

  router.get('/api/sonarqube/docker-status', async (_req: Request, res: Response) => {
    const available = await checkDockerAvailable();
    return res.json({ available });
  });

  router.get('/api/sonarqube/local-status', async (_req: Request, res: Response) => {
    const dockerOk = await checkDockerAvailable();
    if (!dockerOk) {
      return res.json({ container: 'not_found', ready: false });
    }
    const status = await getSonarqubeContainerStatus();
    const ready = status === 'running';
    return res.json({ container: status, ready });
  });

  router.post('/api/sonarqube/setup-local', (req: Request, res: Response) => {
    const state = req.app.locals.state as AppState;
    const body = req.body;
    const port = (body.port as number) ?? 9000;
    const adminUser = (body.adminUser as string) ?? 'admin';
    const adminPassword = (body.adminPassword as string) ?? 'admin';
    const repoId = body.repoId as string | undefined;

    let repoInfo: { id: string; name: string } | null = null;
    if (repoId) {
      const repo = state.db.getRepoById(repoId);
      if (repo) repoInfo = { id: repo.id, name: repo.name };
    }

    const jobId = startSetupJob(state.setupJobs, state.db, {
      port, adminUser, adminPassword, repoInfo,
    });

    return res.json({ jobId, status: 'starting' });
  });

  router.get('/api/sonarqube/setup-status/:jobId', (req: Request, res: Response) => {
    const state = req.app.locals.state as AppState;
    const jobId = req.params.jobId as string;
    const job = state.setupJobs.get(jobId);
    if (!job) throw ApiError.notFound('Setup job not found');
    return res.json({
      status: job.status,
      result: job.result,
      error: job.error,
    });
  });

  router.get('/api/sonarqube/quality-profiles', async (req: Request, res: Response) => {
    const state = req.app.locals.state as AppState;
    const accountId = String(req.query.accountId ?? '');
    const client = resolveSonarClient(state, accountId);
    const profiles = await client.listQualityProfiles();
    return res.json({ profiles });
  });

  router.get('/api/sonarqube/quality-gates', async (req: Request, res: Response) => {
    const state = req.app.locals.state as AppState;
    const accountId = String(req.query.accountId ?? '');
    const client = resolveSonarClient(state, accountId);
    const gates = await client.listQualityGates();
    return res.json({ gates });
  });

  router.get('/api/sonarqube/scan-config', (req: Request, res: Response) => {
    const state = req.app.locals.state as AppState;
    const repoId = String(req.query.repoId ?? '');
    const accountId = String(req.query.accountId ?? '');
    const resourceId = String(req.query.resourceId ?? '');

    const configJson = state.db.getBindingConfig(repoId, accountId, resourceId);
    let scanConfig: ScanConfig = defaultScanConfig();
    if (configJson) {
      try {
        scanConfig = normalizeScanConfig(JSON.parse(configJson));
      } catch {
        /* use default */
      }
    }

    return res.json({
      config: scanConfig,
      defaultExclusions: DEFAULT_EXCLUSIONS,
    });
  });

  router.post('/api/sonarqube/scan-config', async (req: Request, res: Response) => {
    const state = req.app.locals.state as AppState;
    const body = req.body;
    const repoId = body.repoId as string;
    const accountId = body.accountId as string;
    const resourceId = body.resourceId as string;
    const scanConfig = body.config as ScanConfig;
    const qualityGateName = body.qualityGateName as string | undefined;
    const qualityProfileName = body.qualityProfileName as string | undefined;
    const qualityProfileLanguage = body.qualityProfileLanguage as string | undefined;

    state.db.updateBindingConfig(
      repoId, accountId, resourceId, JSON.stringify(scanConfig),
    );

    if (qualityGateName || (qualityProfileName && qualityProfileLanguage)) {
      const client = resolveSonarClient(state, accountId);
      const resource = state.db.getProviderResource(resourceId);
      if (resource) {
        if (qualityGateName) {
          await client.setQualityGate(resource.external_id, qualityGateName);
        }
        if (qualityProfileName && qualityProfileLanguage) {
          await client.setQualityProfile(
            resource.external_id, qualityProfileName, qualityProfileLanguage,
          );
        }
      }
    }

    return res.json({ saved: true });
  });

  // Merge scan routes
  router.use(sonarqubeScanRoutes());

  return router;
}

// -- Helpers --

function resolveSonarClient(state: AppState, accountId: string): SonarClient {
  const account = state.db.getProviderAccount(accountId);
  if (!account) throw ApiError.notFound('Account not found');
  const config = JSON.parse(account.config_json);
  const baseUrl = config.base_url;
  const token = config.token;
  if (!baseUrl) throw ApiError.badRequest('Account missing base_url');
  if (!token) throw ApiError.badRequest('Account missing token');
  return new SonarClient(baseUrl, token);
}
