export interface McpCatalogEntry {
  displayName: string;
  publisher?: string;
  description?: string;
  docsUrl?: string;
  transport: 'stdio';
  command?: string;
  args?: string[];
  envSchema: unknown;
}

export interface McpCatalog {
  version: number;
  entries: Record<string, McpCatalogEntry>;
}

export interface McpServer {
  id: string;
  catalog_id: string;
  name: string;
  config_json: Record<string, unknown>;
  enabled: boolean;
  created_at: string;
  updated_at: string;
}

export interface McpTestResult {
  ok: boolean;
  tools: string[];
  stderr: string;
  error?: string;
}

export interface McpInstallPayload {
  catalogId: string;
  name: string;
  configJson: Record<string, unknown>;
  secrets?: Record<string, string>;
}
