// ---------------------------------------------------------------------------
// PostgreSQL Provider — diagnostics via pg_stat_statements and pg_stat tables
// ---------------------------------------------------------------------------

import type {
  Provider,
  ProviderItem,
  ProviderMeta,
  ProviderResource,
  TaskFieldsFromItem,
  ValidateResult,
} from '../index.js';
import { PgClient } from './client.js';
import { pgItemToTaskFields } from './task-fields.js';

// Re-export for consumers
export { PgClient, normalizeConnectionString, queryPreview, round2 } from './client.js';
export type { PgFinding } from './models.js';

// ── Provider ──

export class PostgresProvider implements Provider {
  meta(): ProviderMeta {
    return {
      id: 'postgres',
      displayName: 'PostgreSQL',
      connectFields: [
        {
          key: 'connection_string',
          label: 'Connection String',
          fieldType: 'password',
          required: false,
          placeholder:
            'postgresql://user:pass@host:5432/dbname (or use fields below)',
        },
        {
          key: 'host',
          label: 'Host',
          fieldType: 'text',
          required: false,
          placeholder: 'localhost',
        },
        {
          key: 'port',
          label: 'Port',
          fieldType: 'text',
          required: false,
          placeholder: '5432',
        },
        {
          key: 'dbname',
          label: 'Database',
          fieldType: 'text',
          required: false,
          placeholder: 'mydb',
        },
        {
          key: 'user',
          label: 'User',
          fieldType: 'text',
          required: false,
          placeholder: 'postgres',
        },
        {
          key: 'password',
          label: 'Password',
          fieldType: 'password',
          required: false,
          placeholder: '',
        },
      ],
      resourceLabel: 'Database',
      hasItemsPanel: true,
    };
  }

  autoSync(): boolean {
    return false;
  }

  async validateCredentials(
    config: Record<string, unknown>,
  ): Promise<ValidateResult> {
    const client = await PgClient.connect(config);
    const version = await client.validate();
    const dbname = await client.currentDatabase();
    return {
      displayName: `${dbname} (PostgreSQL)`,
      extra: { version, dbname },
    };
  }

  async listResources(
    config: Record<string, unknown>,
  ): Promise<ProviderResource[]> {
    const client = await PgClient.connect(config);
    const dbname = await client.currentDatabase();
    return [
      {
        externalId: dbname,
        name: dbname,
        extra: {},
      },
    ];
  }

  async syncItems(
    config: Record<string, unknown>,
    _resourceId: string,
    _since: string | null,
  ): Promise<ProviderItem[]> {
    const client = await PgClient.connect(config);
    const findings = await client.runDiagnostics();
    return findings.map((f) => ({
      externalId: f.externalId,
      title: f.title,
      data: f.data,
    }));
  }

  itemToTaskFields(item: ProviderItem): TaskFieldsFromItem {
    return pgItemToTaskFields(item);
  }

  maskAccount(config: Record<string, unknown>): Record<string, unknown> {
    const masked = { ...config };
    if ('password' in masked) masked.password = '********';
    if ('connection_string' in masked) masked.connection_string = '********';
    return masked;
  }
}
