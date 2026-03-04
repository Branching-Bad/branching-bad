// ---------------------------------------------------------------------------
// Jira Provider — connects to Jira Cloud/Server via REST API
// ---------------------------------------------------------------------------

import type {
  Provider,
  ProviderItem,
  ProviderMeta,
  ProviderResource,
  TaskFieldsFromItem,
  ValidateResult,
} from '../index.js';
import { clientFromConfig } from './client.js';

// Re-export for consumers
export { JiraClient, clientFromConfig } from './client.js';
export type { JiraIssueForTask, JiraMe } from './client.js';

// ── Provider ──

export class JiraProvider implements Provider {
  meta(): ProviderMeta {
    return {
      id: 'jira',
      displayName: 'Jira',
      connectFields: [
        {
          key: 'base_url',
          label: 'Jira URL',
          fieldType: 'text',
          required: true,
          placeholder: 'https://your-org.atlassian.net',
        },
        {
          key: 'email',
          label: 'Email',
          fieldType: 'text',
          required: true,
          placeholder: 'you@example.com',
        },
        {
          key: 'api_token',
          label: 'API Token',
          fieldType: 'password',
          required: true,
          placeholder: '',
        },
      ],
      resourceLabel: 'Board',
      hasItemsPanel: false,
    };
  }

  autoSync(): boolean {
    return true;
  }

  async validateCredentials(
    config: Record<string, unknown>,
  ): Promise<ValidateResult> {
    const client = clientFromConfig(config);
    const me = await client.validateCredentials();
    return {
      displayName: me.displayName,
      extra: {
        accountId: me.accountId,
        emailAddress: me.emailAddress,
      },
    };
  }

  async listResources(
    config: Record<string, unknown>,
  ): Promise<ProviderResource[]> {
    const client = clientFromConfig(config);
    const boards = await client.fetchBoards();
    return boards.map(([id, name]) => ({
      externalId: id,
      name,
      extra: {},
    }));
  }

  async syncItems(
    _config: Record<string, unknown>,
    _resourceId: string,
    _since: string | null,
  ): Promise<ProviderItem[]> {
    // Jira sync goes directly to tasks via the existing sync_tasks handler
    return [];
  }

  itemToTaskFields(_item: ProviderItem): TaskFieldsFromItem {
    // Jira items go directly to tasks, this is not called
    return {
      title: '',
      description: null,
      requirePlan: true,
      autoStart: false,
    };
  }

  maskAccount(config: Record<string, unknown>): Record<string, unknown> {
    return { ...config, api_token: '********' };
  }
}
