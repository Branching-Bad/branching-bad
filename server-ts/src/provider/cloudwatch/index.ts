// ---------------------------------------------------------------------------
// CloudWatch Provider — AWS CloudWatch Logs via SigV4 signed requests
// ---------------------------------------------------------------------------

import type {
  Provider,
  ProviderItem,
  ProviderMeta,
  ProviderResource,
  TaskFieldsFromItem,
  ValidateResult,
} from '../index.js';
import { awsClientFromConfig } from './client.js';

// Re-export for consumers
export { AwsClient, awsClientFromConfig } from './client.js';
export { runPhase1 } from './investigation.js';
export { buildTaskDescription, runAnalysis } from './analysis.js';
export type {
  AnalysisResult,
  CallerIdentity,
  CwInvestigation,
  CwSavedQuery,
  InvestigationRequest,
  InvestigationResult,
  LogEntry,
  LogGroup,
  QueryResult,
  ResultField,
} from './models.js';

// ── Provider ──

export class CloudWatchProvider implements Provider {
  meta(): ProviderMeta {
    return {
      id: 'cloudwatch',
      displayName: 'CloudWatch Logs',
      connectFields: [
        {
          key: 'access_key_id',
          label: 'Access Key ID',
          fieldType: 'text',
          required: true,
          placeholder: 'Access Key ID',
        },
        {
          key: 'secret_access_key',
          label: 'Secret Access Key',
          fieldType: 'password',
          required: true,
          placeholder: 'Secret Access Key',
        },
        {
          key: 'region',
          label: 'Region',
          fieldType: 'text',
          required: true,
          placeholder: 'Region',
        },
      ],
      resourceLabel: 'Log Group',
      hasItemsPanel: false,
    };
  }

  autoSync(): boolean {
    return true;
  }

  async validateCredentials(
    config: Record<string, unknown>,
  ): Promise<ValidateResult> {
    const client = awsClientFromConfig(config);
    const identity = await client.getCallerIdentity();
    const region = String(config.region ?? '');
    return {
      displayName: `${identity.arn} (${region})`,
      extra: { account: identity.account, arn: identity.arn },
    };
  }

  async listResources(
    config: Record<string, unknown>,
  ): Promise<ProviderResource[]> {
    const client = awsClientFromConfig(config);
    const groups = await client.describeLogGroups();
    return groups.map((g) => ({
      externalId: g.logGroupName,
      name: g.logGroupName,
      extra: {},
    }));
  }

  async syncItems(
    _config: Record<string, unknown>,
    _resourceId: string,
    _since: string | null,
  ): Promise<ProviderItem[]> {
    // CloudWatch provider uses the investigation pipeline instead
    return [];
  }

  itemToTaskFields(_item: ProviderItem): TaskFieldsFromItem {
    return {
      title: '',
      description: null,
      requirePlan: true,
      autoStart: false,
    };
  }

  maskAccount(config: Record<string, unknown>): Record<string, unknown> {
    return { ...config, secret_access_key: '********' };
  }
}
