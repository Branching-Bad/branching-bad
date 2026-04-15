import fs from 'node:fs';
import path from 'node:path';
import type { AgentFlavor, ResolvedMcpServer } from './model.js';

export interface ConfigEmission {
  configPath: string | null;
  flavor: AgentFlavor;
}

export async function writeAgentConfig(
  flavor: AgentFlavor,
  servers: ResolvedMcpServer[],
  dir: string,
): Promise<ConfigEmission> {
  if (servers.length === 0) return { configPath: null, flavor };
  fs.mkdirSync(dir, { recursive: true });
  switch (flavor) {
    case 'claude':  return { configPath: writeClaude(servers, dir), flavor };
    case 'codex':   return { configPath: writeCodex(servers, dir), flavor };
    case 'gemini':  return { configPath: writeGemini(servers, dir), flavor };
  }
}

function writeClaude(servers: ResolvedMcpServer[], dir: string): string {
  const mcpServers: Record<string, unknown> = {};
  for (const s of servers) {
    mcpServers[s.name] = { command: s.command, args: s.args, env: s.env };
  }
  const file = path.join(dir, 'claude-mcp.json');
  fs.writeFileSync(file, JSON.stringify({ mcpServers }, null, 2), { mode: 0o600 });
  return file;
}

function tomlEscape(v: string): string {
  return '"' + v.replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';
}

function writeCodex(servers: ResolvedMcpServer[], dir: string): string {
  const lines: string[] = [];
  for (const s of servers) {
    lines.push(`[mcp_servers.${s.name}]`);
    lines.push(`command = ${tomlEscape(s.command)}`);
    lines.push(`args = [${s.args.map(tomlEscape).join(', ')}]`);
    lines.push('');
    lines.push(`[mcp_servers.${s.name}.env]`);
    for (const [k, v] of Object.entries(s.env)) {
      lines.push(`${k} = ${tomlEscape(v)}`);
    }
    lines.push('');
  }
  const file = path.join(dir, 'config.toml');
  fs.writeFileSync(file, lines.join('\n'), { mode: 0o600 });
  return file;
}

function writeGemini(servers: ResolvedMcpServer[], dir: string): string {
  const mcpServers: Record<string, unknown> = {};
  for (const s of servers) {
    mcpServers[s.name] = { command: s.command, args: s.args, env: s.env };
  }
  const file = path.join(dir, 'gemini-settings.json');
  fs.writeFileSync(file, JSON.stringify({ mcpServers }, null, 2), { mode: 0o600 });
  return file;
}
