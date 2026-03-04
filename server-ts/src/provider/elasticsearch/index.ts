// ---------------------------------------------------------------------------
// Elasticsearch Provider — connects to Elasticsearch via REST API
// ---------------------------------------------------------------------------

import type {
  Provider,
  ProviderItem,
  ProviderMeta,
  ProviderResource,
  TaskFieldsFromItem,
  ValidateResult,
} from '../index.js';
import { EsClient } from './client.js';

// Re-export for consumers
export { EsClient, logEntryFromHit } from './client.js';
export { runPhase1 } from './investigation.js';
export { buildTaskDescription, runAnalysis } from './analysis.js';
export type {
  AnalysisResult,
  ClusterHealth,
  EsAuth,
  EsInvestigation,
  EsInvestigationSummary,
  EsSavedQuery,
  IndexInfo,
  InvestigationRequest,
  InvestigationResult,
  LogEntry,
  SearchResult,
} from './models.js';

// ── Provider ──

export class ElasticsearchProvider implements Provider {
  meta(): ProviderMeta {
    return {
      id: 'elasticsearch',
      displayName: 'Elasticsearch',
      connectFields: [
        {
          key: 'url',
          label: 'URL',
          fieldType: 'text',
          required: true,
          placeholder: 'https://elastic.example.com:9200',
        },
        {
          key: 'username',
          label: 'Username',
          fieldType: 'text',
          required: false,
          placeholder: 'elastic',
        },
        {
          key: 'password',
          label: 'Password',
          fieldType: 'password',
          required: false,
          placeholder: 'Password',
        },
        {
          key: 'api_key',
          label: 'API Key',
          fieldType: 'password',
          required: false,
          placeholder: 'ES API key (alternative to user/pass)',
        },
      ],
      resourceLabel: 'Index Pattern',
      hasItemsPanel: false,
    };
  }

  autoSync(): boolean {
    return true;
  }

  async validateCredentials(
    config: Record<string, unknown>,
  ): Promise<ValidateResult> {
    const client = EsClient.fromConfig(config);
    const health = await client.clusterHealth();
    return {
      displayName: `${health.clusterName} (${health.status})`,
      extra: {
        cluster_name: health.clusterName,
        status: health.status,
        number_of_nodes: health.numberOfNodes,
      },
    };
  }

  async listResources(
    config: Record<string, unknown>,
  ): Promise<ProviderResource[]> {
    const client = EsClient.fromConfig(config);
    const indices = await client.listIndices();
    return indices.map((idx) => ({
      externalId: idx.index,
      name: idx.index,
      extra: {
        health: idx.health,
        docs_count: idx.docsCount,
        store_size: idx.storeSize,
      },
    }));
  }

  async syncItems(
    _config: Record<string, unknown>,
    _resourceId: string,
    _since: string | null,
  ): Promise<ProviderItem[]> {
    // Elasticsearch uses the investigation pipeline instead
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
    const masked = { ...config };
    if ('password' in masked) masked.password = '********';
    if ('api_key' in masked) masked.api_key = '********';
    return masked;
  }
}
