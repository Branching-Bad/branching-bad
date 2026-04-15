import type { McpCatalog, McpServer, ResolvedMcpServer } from './model.js';
import type { SecretStore } from './secretStore.js';

const SECRET_PREFIX = '$secret:';

/** Convert an installed McpServer row + catalog entry + secret store into runtime shape. */
export async function resolveMcpServer(
  server: McpServer,
  catalog: McpCatalog,
  secrets: SecretStore,
): Promise<ResolvedMcpServer> {
  const entry = catalog.entries[server.catalog_id];
  if (!entry && server.catalog_id !== 'custom') {
    throw new Error(`unknown catalog entry: ${server.catalog_id}`);
  }

  // Custom: config_json holds { command, args, env }
  if (server.catalog_id === 'custom') {
    const cfg = server.config_json as { command?: string; args?: string[]; env?: Record<string, string> };
    if (!cfg.command) throw new Error('custom MCP missing command');
    const env = await substituteSecrets(server.id, cfg.env ?? {}, secrets);
    return {
      id: server.id,
      name: server.name,
      command: cfg.command,
      args: cfg.args ?? [],
      env,
    };
  }

  // Known catalog entry: command/args come from catalog, env from config_json (with secret substitution)
  const env = await substituteSecrets(server.id, server.config_json as Record<string, unknown>, secrets);
  return {
    id: server.id,
    name: server.name,
    command: entry!.command!,
    args: entry!.args ?? [],
    env,
  };
}

async function substituteSecrets(
  serverId: string,
  raw: Record<string, unknown>,
  secrets: SecretStore,
): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw)) {
    if (typeof v !== 'string') continue;
    if (v.startsWith(SECRET_PREFIX)) {
      const resolved = await secrets.get(serverId, k);
      if (resolved != null) out[k] = resolved;
    } else {
      out[k] = v;
    }
  }
  return out;
}
