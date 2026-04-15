import { Db, nowIso } from './index.js';
import type { McpServer } from '../mcp/model.js';

declare module './index.js' {
  interface Db {
    createMcpServer(id: string, catalogId: string, name: string, configJson: Record<string, unknown>): McpServer;
    updateMcpServer(id: string, patch: { name?: string; configJson?: Record<string, unknown>; enabled?: boolean }): void;
    getMcpServer(id: string): McpServer | null;
    listMcpServers(): McpServer[];
    deleteMcpServer(id: string): void;

    setAgentProfileMcps(profileId: string, mcpServerIds: string[]): void;
    listMcpsForProfile(profileId: string): McpServer[];
  }
}

const rowToServer = (r: any): McpServer => ({
  id: r.id,
  catalog_id: r.catalog_id,
  name: r.name,
  config_json: JSON.parse(r.config_json),
  enabled: !!r.enabled,
  created_at: r.created_at,
  updated_at: r.updated_at,
});

Db.prototype.createMcpServer = function (id, catalogId, name, configJson) {
  const ts = nowIso();
  this.connect().prepare(
    `INSERT INTO mcp_servers (id, catalog_id, name, config_json, enabled, created_at, updated_at)
     VALUES (?, ?, ?, ?, 1, ?, ?)`,
  ).run(id, catalogId, name, JSON.stringify(configJson), ts, ts);
  return this.getMcpServer(id)!;
};

Db.prototype.updateMcpServer = function (id, patch) {
  const parts: string[] = [];
  const vals: any[] = [];
  if (patch.name !== undefined) { parts.push('name = ?'); vals.push(patch.name); }
  if (patch.configJson !== undefined) { parts.push('config_json = ?'); vals.push(JSON.stringify(patch.configJson)); }
  if (patch.enabled !== undefined) { parts.push('enabled = ?'); vals.push(patch.enabled ? 1 : 0); }
  parts.push('updated_at = ?'); vals.push(nowIso());
  vals.push(id);
  this.connect().prepare(`UPDATE mcp_servers SET ${parts.join(', ')} WHERE id = ?`).run(...vals);
};

Db.prototype.getMcpServer = function (id) {
  const row = this.connect().prepare('SELECT * FROM mcp_servers WHERE id = ?').get(id);
  return row ? rowToServer(row) : null;
};

Db.prototype.listMcpServers = function () {
  return this.connect().prepare('SELECT * FROM mcp_servers ORDER BY created_at DESC').all().map(rowToServer);
};

Db.prototype.deleteMcpServer = function (id) {
  this.connect().prepare('DELETE FROM mcp_servers WHERE id = ?').run(id);
};

Db.prototype.setAgentProfileMcps = function (profileId, mcpServerIds) {
  const db = this.connect();
  db.prepare('BEGIN').run();
  try {
    db.prepare('DELETE FROM agent_profile_mcp WHERE agent_profile_id = ?').run(profileId);
    const ins = db.prepare('INSERT INTO agent_profile_mcp (agent_profile_id, mcp_server_id) VALUES (?, ?)');
    for (const sid of mcpServerIds) ins.run(profileId, sid);
    db.prepare('COMMIT').run();
  } catch (err) {
    db.prepare('ROLLBACK').run();
    throw err;
  }
};

Db.prototype.listMcpsForProfile = function (profileId) {
  return this.connect().prepare(
    `SELECT s.* FROM mcp_servers s
     JOIN agent_profile_mcp ap ON ap.mcp_server_id = s.id
     WHERE ap.agent_profile_id = ? AND s.enabled = 1
     ORDER BY s.created_at`,
  ).all(profileId).map(rowToServer);
};
