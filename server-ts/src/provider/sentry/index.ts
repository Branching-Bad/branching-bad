// ---------------------------------------------------------------------------
// Sentry Provider — connects to Sentry via REST API
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
import { extractStackTrace } from './stackTrace.js';

// Re-export for consumers
export { SentryClient, clientFromConfig } from './client.js';
export type { SentryIssue, SentryOrg, SentryProjectInfo } from './models.js';
export { extractStackTrace } from './stackTrace.js';

// ── Provider ──

export class SentryProvider implements Provider {
  meta(): ProviderMeta {
    return {
      id: 'sentry',
      displayName: 'Sentry',
      connectFields: [
        {
          key: 'base_url',
          label: 'Sentry URL',
          fieldType: 'text',
          required: true,
          placeholder: 'https://sentry.io (or https://your-org.sentry.io)',
        },
        {
          key: 'org_slug',
          label: 'Organization Slug',
          fieldType: 'text',
          required: true,
          placeholder: 'my-org',
        },
        {
          key: 'auth_token',
          label: 'Auth Token',
          fieldType: 'password',
          required: true,
          placeholder: '',
        },
      ],
      resourceLabel: 'Project',
      hasItemsPanel: true,
    };
  }

  autoSync(): boolean {
    return true;
  }

  async validateCredentials(
    config: Record<string, unknown>,
  ): Promise<ValidateResult> {
    const client = clientFromConfig(config);
    const org = await client.validateCredentials();
    return {
      displayName: org.name,
      extra: { slug: org.slug },
    };
  }

  async listResources(
    config: Record<string, unknown>,
  ): Promise<ProviderResource[]> {
    const client = clientFromConfig(config);
    const projects = await client.listProjects();
    return projects.map((p) => ({
      externalId: p.slug,
      name: p.name,
      extra: { id: p.id },
    }));
  }

  async syncItems(
    config: Record<string, unknown>,
    resourceId: string,
    since: string | null,
  ): Promise<ProviderItem[]> {
    const client = clientFromConfig(config);
    const issues = await client.fetchNewIssues(resourceId, since);

    const items: ProviderItem[] = [];
    for (const issue of issues) {
      let eventJson: unknown = null;
      try {
        eventJson = await client.fetchLatestEvent(issue.id);
      } catch (e) {
        console.error(
          `Sentry: failed to fetch latest event for issue ${issue.id}: ${e}`,
        );
      }
      items.push({
        externalId: issue.id,
        title: issue.title,
        data: {
          culprit: issue.culprit,
          level: issue.level,
          first_seen: issue.firstSeen,
          last_seen: issue.lastSeen,
          occurrence_count: issue.count,
          metadata: issue.metadata,
          latest_event: eventJson,
        },
      });
    }

    return items;
  }

  itemToTaskFields(item: ProviderItem): TaskFieldsFromItem {
    const data = item.data;
    const culprit = String(data.culprit ?? 'unknown');
    const level = String(data.level ?? 'error');
    const firstSeen = String(data.first_seen ?? 'unknown');
    const lastSeen = String(data.last_seen ?? 'unknown');
    const count = Number(data.occurrence_count ?? 1);
    const environments = '[]';

    const stackTrace = extractStackTrace(data.latest_event as any) ?? '';

    const description =
      `## Sentry Error\n\n` +
      `**Error:** ${item.title}\n` +
      `**Culprit:** ${culprit}\n` +
      `**Level:** ${level}\n` +
      `**Environments:** ${environments}\n` +
      `**Occurrences:** ${count}\n` +
      `**First Seen:** ${firstSeen}\n` +
      `**Last Seen:** ${lastSeen}\n\n` +
      `### Stack Trace\n\`\`\`\n${stackTrace}\n\`\`\`\n`;

    return {
      title: `[SENTRY] ${item.title}`,
      description,
      requirePlan: true,
      autoStart: false,
    };
  }

  maskAccount(config: Record<string, unknown>): Record<string, unknown> {
    return { ...config, auth_token: '********' };
  }
}
