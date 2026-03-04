import type { Db } from '../../db/index.js';
import {
  SonarClient,
  issuesToItemTuples,
  runScan,
} from './index.js';
import type { ScanConfig } from './index.js';

export interface RunScanParams {
  scanId: string;
  repoPath: string;
  projectKey: string;
  baseUrl: string;
  token: string;
  scanConfig: ScanConfig;
  accountId: string;
  resourceId: string | null;
}

export function startScanJob(db: Db, params: RunScanParams): void {
  const {
    scanId, repoPath, projectKey, baseUrl, token,
    scanConfig, accountId, resourceId,
  } = params;

  setImmediate(async () => {
    try {
      await runScan(repoPath, projectKey, baseUrl, token, scanConfig);
      const client = new SonarClient(baseUrl, token);
      const issues = await client.searchIssues(projectKey);
      const issuesCount = issues.length;

      if (resourceId) {
        const items = issuesToItemTuples(issues);
        db.upsertProviderItems(accountId, resourceId, 'sonarqube', items);
      }

      db.updateSonarScanStatus(scanId, 'completed', issuesCount, undefined);
    } catch (e: any) {
      db.updateSonarScanStatus(scanId, 'failed', undefined, e.message);
    }
  });
}
