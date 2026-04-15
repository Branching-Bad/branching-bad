// server-ts/src/mcp/model.ts

export type McpTransport = 'stdio'; // v1: stdio only; http/sse later

export interface McpCatalogEntry {
  displayName: string;
  publisher?: string;
  description?: string;
  docsUrl?: string;
  transport: McpTransport;
  command?: string;              // absent for 'custom' (user provides in configJson)
  args?: string[];
  envSchema: unknown;            // JSON Schema draft-07 object
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

export interface McpSecretRow {
  id: string;
  mcp_server_id: string;
  env_key: string;
  value_cipher: Buffer;
}

export type AgentFlavor = 'claude' | 'codex' | 'gemini';

export interface ResolvedMcpServer {
  id: string;
  name: string;
  command: string;
  args: string[];
  env: Record<string, string>;
}
