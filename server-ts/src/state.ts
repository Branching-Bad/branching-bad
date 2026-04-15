import type { Db } from './db/index.js';
import type { ProcessManager } from './processManager.js';
import type { ProviderRegistry } from './provider/index.js';
import type { SecretStore } from './mcp/secretStore.js';

export interface SetupJob {
  status: string;
  error?: string;
  result?: any;
}

export interface AppState {
  db: Db;
  processManager: ProcessManager;
  registry: ProviderRegistry;
  setupJobs: Map<string, SetupJob>;
  workflowScheduler?: { refresh(id: string): void };
  secretStore: SecretStore;
}
