import { v4 as uuidv4 } from 'uuid';
import type { Db } from '../../db/index.js';
import type { SetupJob } from '../../state.js';
import {
  checkDockerAvailable,
  changePasswordBasicAuth,
  createProjectBasicAuth,
  generateTokenBasicAuth,
  startSonarqubeContainer,
  waitForSonarqubeReady,
} from './index.js';

export interface SetupLocalParams {
  port: number;
  adminUser: string;
  adminPassword: string;
  repoInfo: { id: string; name: string } | null;
}

export function startSetupJob(
  setupJobs: Map<string, SetupJob>,
  db: Db,
  params: SetupLocalParams,
): string {
  const jobId = uuidv4();
  const { port, adminUser, adminPassword, repoInfo } = params;
  const baseUrl = `http://localhost:${port}`;

  setupJobs.set(jobId, { status: 'starting' });

  setImmediate(async () => {
    const updateJob = (update: Partial<SetupJob>): void => {
      const current = setupJobs.get(jobId);
      if (current) setupJobs.set(jobId, { ...current, ...update });
    };

    // Step 1: Check Docker
    const dockerOk = await checkDockerAvailable();
    if (!dockerOk) {
      updateJob({ status: 'failed', error: 'Docker is not available' });
      return;
    }

    // Step 2: Start container
    try {
      await startSonarqubeContainer(port);
    } catch (e: any) {
      updateJob({ status: 'failed', error: `Failed to start container: ${e.message}` });
      return;
    }

    updateJob({ status: 'waiting' });

    // Step 3: Wait for ready
    try {
      await waitForSonarqubeReady(baseUrl, 180);
    } catch (e: any) {
      updateJob({ status: 'failed', error: `SonarQube did not start: ${e.message}` });
      return;
    }

    updateJob({ status: 'configuring' });

    // Step 4: Change password
    if (adminPassword !== 'admin') {
      try {
        await changePasswordBasicAuth(baseUrl, 'admin', 'admin', adminPassword);
      } catch {
        // Already changed, fine
      }
    }

    // Step 5: Generate token
    const tokenName = `idea-agent-${jobId.slice(0, 8)}`;
    let token: string;
    try {
      token = await generateTokenBasicAuth(baseUrl, adminUser, adminPassword, tokenName);
    } catch (e: any) {
      updateJob({ status: 'failed', error: `Token generation failed: ${e.message}` });
      return;
    }

    // Step 6: Auto-bind if repoId was provided
    if (repoInfo) {
      const projectKey = repoInfo.name
        .toLowerCase()
        .replace(/[^a-z0-9_-]/g, '-');

      try {
        await createProjectBasicAuth(
          baseUrl, adminUser, adminPassword, projectKey, repoInfo.name,
        );
      } catch (e: any) {
        updateJob({ status: 'failed', error: `Project creation failed: ${e.message}` });
        return;
      }

      const config = { base_url: baseUrl, token, mode: 'local' };
      const displayName = `Local (localhost:${port})`;
      try {
        const account = db.upsertProviderAccount('sonarqube', config, displayName);
        const resources: Array<[string, string, string]> = [
          [projectKey, repoInfo.name, '{}'],
        ];
        db.upsertProviderResources(account.id, 'sonarqube', resources);
        const allResources = db.listProviderResources(account.id);
        const res = allResources.find((r) => r.external_id === projectKey);
        if (res) {
          db.createProviderBinding(
            repoInfo.id, account.id, res.id, 'sonarqube', '{}',
          );
        }
      } catch (e: any) {
        console.error(`Warning: failed to create local SQ account: ${e.message}`);
      }
    }

    updateJob({
      status: 'completed',
      result: { base_url: baseUrl, token },
    });
  });

  return jobId;
}
