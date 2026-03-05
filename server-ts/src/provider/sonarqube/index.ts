// ---------------------------------------------------------------------------
// SonarQube Provider — connects to SonarQube via REST API + Docker scanning
// ---------------------------------------------------------------------------

import type {
  Provider,
  ProviderItem,
  ProviderMeta,
  ProviderResource,
  TaskFieldsFromItem,
  ValidateResult,
} from '../index.js';
import { sonarClientFromConfig } from './client.js';
import { issuesToItemTuples } from './helpers.js';

// Re-export for consumers
export { SonarClient, sonarClientFromConfig } from './client.js';
export {
  changePasswordBasicAuth,
  createProjectBasicAuth,
  generateTokenBasicAuth,
} from './auth.js';
export { issuesToItemTuples } from './helpers.js';
export {
  checkDockerAvailable,
  getSonarqubeContainerStatus,
  startSonarqubeContainer,
  waitForSonarqubeReady,
  runScan,
  mergeExclusions,
  buildSonarProperties,
} from './docker.js';
export {
  DEFAULT_EXCLUSIONS,
  defaultScanConfig,
  normalizeScanConfig,
} from './models.js';
export type {
  ContainerStatus,
  ScanConfig,
  SonarScan,
  SqIssue,
  SqProject,
  SqQualityGate,
  SqQualityProfile,
} from './models.js';

// ── Provider ──

export class SonarQubeProvider implements Provider {
  meta(): ProviderMeta {
    return {
      id: 'sonarqube',
      displayName: 'SonarQube',
      connectFields: [
        {
          key: 'base_url',
          label: 'SonarQube URL',
          fieldType: 'text',
          required: true,
          placeholder: 'https://sonar.example.com',
        },
        {
          key: 'token',
          label: 'Token',
          fieldType: 'password',
          required: true,
          placeholder: 'squ_...',
        },
        {
          key: 'mode',
          label: 'Mode',
          fieldType: 'text',
          required: true,
          placeholder: 'online or local',
        },
      ],
      resourceLabel: 'Project',
      hasItemsPanel: true,
    };
  }

  autoSync(): boolean {
    return false;
  }

  async validateCredentials(
    config: Record<string, unknown>,
  ): Promise<ValidateResult> {
    const client = sonarClientFromConfig(config);
    const displayName = await client.validate();
    return { displayName, extra: {} };
  }

  async listResources(
    config: Record<string, unknown>,
  ): Promise<ProviderResource[]> {
    const client = sonarClientFromConfig(config);
    const projects = await client.listProjects();
    return projects.map((p) => ({
      externalId: p.key,
      name: p.name,
      extra: {},
    }));
  }

  async syncItems(
    config: Record<string, unknown>,
    resourceId: string,
    _since: string | null,
  ): Promise<ProviderItem[]> {
    const client = sonarClientFromConfig(config);
    const issues = await client.searchIssues(resourceId);
    const tuples = issuesToItemTuples(issues);
    return tuples.map(([externalId, title, dataJson]) => ({
      externalId,
      title,
      data: JSON.parse(dataJson),
    }));
  }

  itemToTaskFields(item: ProviderItem): TaskFieldsFromItem {
    const data = item.data;
    const severity = String(data.severity ?? 'MAJOR');
    const rule = String(data.rule ?? 'unknown');
    const message = String(data.message ?? '');
    const component = String(data.component ?? '');
    const line = data.line as number | null;
    const issueType = String(data.type ?? 'CODE_SMELL');
    const effort = String(data.effort ?? 'N/A');

    const location = line != null ? `${component}:${line}` : component;

    const description =
      `## SonarQube Issue\n\n` +
      `**Rule:** ${rule}\n` +
      `**Type:** ${issueType}\n` +
      `**Severity:** ${severity}\n` +
      `**Location:** \`${location}\`\n` +
      `**Effort:** ${effort}\n\n` +
      `### Message\n${message}`;

    const prefixMap: Record<string, string> = {
      BLOCKER: '[SQ-BLOCKER]',
      CRITICAL: '[SQ-CRITICAL]',
      MAJOR: '[SQ-MAJOR]',
      MINOR: '[SQ-MINOR]',
      INFO: '[SQ-INFO]',
    };
    const prefix = prefixMap[severity] ?? '[SQ]';

    return {
      title: `${prefix} ${message}`,
      description,
      requirePlan: false,
      autoStart: false,
    };
  }

  maskAccount(config: Record<string, unknown>): Record<string, unknown> {
    return { ...config, token: '********' };
  }
}
