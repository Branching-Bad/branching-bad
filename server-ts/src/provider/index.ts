// ---------------------------------------------------------------------------
// Provider system — pluggable provider interface + registry
// ---------------------------------------------------------------------------

import { CloudWatchProvider } from './cloudwatch/index.js';
import { ElasticsearchProvider } from './elasticsearch/index.js';
import { JiraProvider } from './jira/index.js';
import { PostgresProvider } from './postgres/index.js';
import { SentryProvider } from './sentry/index.js';
import { SonarQubeProvider } from './sonarqube/index.js';

export interface ConnectField {
  key: string;
  label: string;
  fieldType: 'text' | 'password';
  required: boolean;
  placeholder: string;
}

export interface ProviderMeta {
  id: string;
  displayName: string;
  connectFields: ConnectField[];
  resourceLabel: string;
  hasItemsPanel: boolean;
}

export interface ValidateResult {
  displayName: string;
  extra: Record<string, unknown>;
}

export interface ProviderResource {
  externalId: string;
  name: string;
  extra: Record<string, unknown>;
}

export interface ProviderItem {
  externalId: string;
  title: string;
  data: Record<string, unknown>;
}

export interface TaskFieldsFromItem {
  title: string;
  description: string | null;
  requirePlan: boolean;
  autoStart: boolean;
}

export interface Provider {
  meta(): ProviderMeta;
  autoSync(): boolean;
  validateCredentials(config: Record<string, unknown>): Promise<ValidateResult>;
  listResources(config: Record<string, unknown>): Promise<ProviderResource[]>;
  syncItems(
    config: Record<string, unknown>,
    resourceExternalId: string,
    since: string | null,
  ): Promise<ProviderItem[]>;
  itemToTaskFields(item: ProviderItem): TaskFieldsFromItem;
  maskAccount(config: Record<string, unknown>): Record<string, unknown>;
}

export class ProviderRegistry {
  private providers: Map<string, Provider> = new Map();

  register(provider: Provider): void {
    const id = provider.meta().id;
    this.providers.set(id, provider);
  }

  get(id: string): Provider | undefined {
    return this.providers.get(id);
  }

  all(): Provider[] {
    return Array.from(this.providers.values());
  }

  allMetas(): ProviderMeta[] {
    return this.all().map((p) => p.meta());
  }
}

export function registerAll(registry: ProviderRegistry): void {
  registry.register(new JiraProvider());
  registry.register(new SentryProvider());
  registry.register(new PostgresProvider());
  registry.register(new CloudWatchProvider());
  registry.register(new SonarQubeProvider());
  registry.register(new ElasticsearchProvider());
}
