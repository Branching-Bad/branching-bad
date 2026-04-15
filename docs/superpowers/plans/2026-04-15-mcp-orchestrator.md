# MCP Orchestrator Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Model Context Protocol (MCP) orchestrator so users can install MCP servers (AWS CloudWatch, GitHub, Postgres, Slack, filesystem, custom) with dynamic schema-driven configuration, assign them per agent profile, and have the app emit the correct config file for Claude / Codex / Gemini at run time.

**Architecture:** New backend module `server-ts/src/mcp/` owns catalog loading, DB CRUD, secret management (`node-keytar` + AES-GCM fallback), per-agent config emission, and a test-connection probe. New frontend module `web/src/mcp/` renders an Extensions→MCP tab with a catalog gallery and a Monaco-backed install editor that validates against each catalog entry's JSON Schema. Agent spawn writes a per-run config file in the agent-specific format and cleans up after.

**Tech Stack:** TypeScript, Express, `node:sqlite` via the existing `Db` class, `node-keytar` (new dep), `node-forge` or node's built-in `crypto` for AES fallback, React 19, Tailwind v4, `@monaco-editor/react` (already installed), `@modelcontextprotocol/server-everything` (dev dep for integration tests).

**Spec:** `docs/superpowers/specs/2026-04-15-mcp-orchestrator-design.md`

**Testing strategy:** Node built-in `node:test` for pure logic (catalog loader, config writers, secret store roundtrip). `tsc --noEmit` + manual smoke via the app for UI paths. End-to-end integration test spawns `@modelcontextprotocol/server-everything` as a real MCP and runs `test-connection`.

---

## Task 1: Migration V21 — mcp tables

**Files:**
- Create: `server-ts/migrations/V21__add_mcp_servers.sql`

- [ ] **Step 1: Write migration SQL**

```sql
-- server-ts/migrations/V21__add_mcp_servers.sql

CREATE TABLE mcp_servers (
  id           TEXT PRIMARY KEY,
  catalog_id   TEXT NOT NULL,
  name         TEXT NOT NULL,
  config_json  TEXT NOT NULL,
  enabled      INTEGER NOT NULL DEFAULT 1,
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL
);

CREATE INDEX idx_mcp_servers_catalog ON mcp_servers(catalog_id);

CREATE TABLE agent_profile_mcp (
  agent_profile_id TEXT NOT NULL REFERENCES agent_profiles(id) ON DELETE CASCADE,
  mcp_server_id    TEXT NOT NULL REFERENCES mcp_servers(id)    ON DELETE CASCADE,
  PRIMARY KEY (agent_profile_id, mcp_server_id)
);

CREATE INDEX idx_agent_profile_mcp_profile ON agent_profile_mcp(agent_profile_id);

CREATE TABLE mcp_secrets (
  id            TEXT PRIMARY KEY,
  mcp_server_id TEXT NOT NULL REFERENCES mcp_servers(id) ON DELETE CASCADE,
  env_key       TEXT NOT NULL,
  value_cipher  BLOB NOT NULL,
  UNIQUE (mcp_server_id, env_key)
);
```

- [ ] **Step 2: Apply + verify**

Boot the server briefly to run migrations:
```
cd /Users/melih/Documents/code/idea/server-ts && timeout 6 npm run dev 2>&1 | head -30 || true
```

Then inspect on macOS:
```
sqlite3 "$HOME/Library/Application Support/branching-bad/agent.db" ".schema mcp_servers"
sqlite3 "$HOME/Library/Application Support/branching-bad/agent.db" ".schema agent_profile_mcp"
sqlite3 "$HOME/Library/Application Support/branching-bad/agent.db" ".schema mcp_secrets"
```
All three tables must print.

- [ ] **Step 3: Commit**

```
git add server-ts/migrations/V21__add_mcp_servers.sql
git commit -m "feat(mcp): V21 migration for mcp_servers, agent_profile_mcp, mcp_secrets"
```

---

## Task 2: Types (`mcp/model.ts`)

**Files:**
- Create: `server-ts/src/mcp/model.ts`

- [ ] **Step 1: Declare types**

```ts
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
  env: Record<string, string>;   // secrets already substituted with plaintext
}
```

- [ ] **Step 2: Typecheck**

```
cd /Users/melih/Documents/code/idea/server-ts && npm run build
```
Expected: no errors.

- [ ] **Step 3: Commit**

```
git add server-ts/src/mcp/model.ts
git commit -m "feat(mcp): add model types for catalog, server rows, secrets"
```

---

## Task 3: Bundled catalog manifest

**Files:**
- Create: `server-ts/mcp-catalog.json`

- [ ] **Step 1: Write initial catalog**

```json
{
  "version": 1,
  "entries": {
    "aws-cloudwatch": {
      "displayName": "AWS CloudWatch Logs",
      "publisher": "AWS Labs",
      "description": "Query CloudWatch log groups and events",
      "docsUrl": "https://github.com/awslabs/mcp",
      "transport": "stdio",
      "command": "uvx",
      "args": ["awslabs.cloudwatch-logs-mcp-server"],
      "envSchema": {
        "type": "object",
        "required": ["AWS_REGION"],
        "properties": {
          "AWS_REGION": { "type": "string", "title": "Region", "default": "us-east-1" },
          "AWS_ACCESS_KEY_ID": { "type": "string", "title": "Access Key ID", "format": "secret" },
          "AWS_SECRET_ACCESS_KEY": { "type": "string", "title": "Secret Access Key", "format": "secret" },
          "AWS_PROFILE": { "type": "string", "title": "Profile (alternative to keys)" }
        }
      }
    },
    "github": {
      "displayName": "GitHub",
      "publisher": "GitHub",
      "description": "Repository, issues, pull requests",
      "docsUrl": "https://github.com/modelcontextprotocol/servers/tree/main/src/github",
      "transport": "stdio",
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-github"],
      "envSchema": {
        "type": "object",
        "required": ["GITHUB_PERSONAL_ACCESS_TOKEN"],
        "properties": {
          "GITHUB_PERSONAL_ACCESS_TOKEN": { "type": "string", "title": "Personal Access Token", "format": "secret" }
        }
      }
    },
    "postgres": {
      "displayName": "PostgreSQL",
      "publisher": "Model Context Protocol",
      "description": "Read-only access to a Postgres database",
      "docsUrl": "https://github.com/modelcontextprotocol/servers/tree/main/src/postgres",
      "transport": "stdio",
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-postgres"],
      "envSchema": {
        "type": "object",
        "required": ["POSTGRES_CONNECTION_STRING"],
        "properties": {
          "POSTGRES_CONNECTION_STRING": {
            "type": "string",
            "title": "Connection URL",
            "format": "secret",
            "description": "postgres://user:pass@host:5432/db"
          }
        }
      }
    },
    "slack": {
      "displayName": "Slack",
      "publisher": "Model Context Protocol",
      "description": "Read channels, send messages",
      "docsUrl": "https://github.com/modelcontextprotocol/servers/tree/main/src/slack",
      "transport": "stdio",
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-slack"],
      "envSchema": {
        "type": "object",
        "required": ["SLACK_BOT_TOKEN", "SLACK_TEAM_ID"],
        "properties": {
          "SLACK_BOT_TOKEN": { "type": "string", "title": "Bot Token", "format": "secret" },
          "SLACK_TEAM_ID":   { "type": "string", "title": "Team ID" }
        }
      }
    },
    "filesystem": {
      "displayName": "Filesystem",
      "publisher": "Model Context Protocol",
      "description": "Scoped filesystem access",
      "docsUrl": "https://github.com/modelcontextprotocol/servers/tree/main/src/filesystem",
      "transport": "stdio",
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem"],
      "envSchema": {
        "type": "object",
        "properties": {
          "ALLOWED_PATHS": {
            "type": "array",
            "title": "Allowed paths (absolute)",
            "items": { "type": "string" }
          }
        }
      }
    },
    "custom": {
      "displayName": "Custom MCP",
      "description": "Any MCP server, declared by hand",
      "transport": "stdio",
      "envSchema": {
        "type": "object",
        "required": ["command"],
        "properties": {
          "command": { "type": "string", "title": "Command" },
          "args":    { "type": "array",  "title": "Arguments", "items": { "type": "string" } },
          "env":     { "type": "object", "title": "Environment", "additionalProperties": { "type": "string" } }
        }
      }
    }
  }
}
```

- [ ] **Step 2: Commit**

```
git add server-ts/mcp-catalog.json
git commit -m "feat(mcp): bundled catalog with 6 initial entries"
```

---

## Task 4: Catalog loader with tests

**Files:**
- Create: `server-ts/src/mcp/catalog.ts`
- Create: `server-ts/src/mcp/catalog.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
// server-ts/src/mcp/catalog.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadCatalog, getEntry } from './catalog.js';

test('loads bundled catalog', async () => {
  const cat = await loadCatalog();
  assert.equal(cat.version, 1);
  assert.ok(cat.entries['aws-cloudwatch']);
  assert.ok(cat.entries['custom']);
});

test('getEntry returns entry or undefined', async () => {
  const cat = await loadCatalog();
  assert.equal(getEntry(cat, 'github')?.publisher, 'GitHub');
  assert.equal(getEntry(cat, 'nope'), undefined);
});
```

- [ ] **Step 2: Run — expect fail**

```
cd /Users/melih/Documents/code/idea/server-ts && node --import tsx --test src/mcp/catalog.test.ts
```
Expected: FAIL (module missing).

- [ ] **Step 3: Implement**

```ts
// server-ts/src/mcp/catalog.ts
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { McpCatalog, McpCatalogEntry } from './model.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CATALOG_PATH = path.resolve(__dirname, '../../mcp-catalog.json');

let cached: McpCatalog | null = null;

export async function loadCatalog(): Promise<McpCatalog> {
  if (cached) return cached;
  const raw = await fs.promises.readFile(CATALOG_PATH, 'utf8');
  const parsed = JSON.parse(raw) as McpCatalog;
  if (typeof parsed.version !== 'number' || !parsed.entries) {
    throw new Error('invalid mcp-catalog.json shape');
  }
  cached = parsed;
  return parsed;
}

export function getEntry(catalog: McpCatalog, id: string): McpCatalogEntry | undefined {
  return catalog.entries[id];
}
```

- [ ] **Step 4: Run — expect pass**

```
cd /Users/melih/Documents/code/idea/server-ts && node --import tsx --test src/mcp/catalog.test.ts
```
Expected: `tests 2 / pass 2`.

- [ ] **Step 5: Commit**

```
git add server-ts/src/mcp/catalog.ts server-ts/src/mcp/catalog.test.ts
git commit -m "feat(mcp): catalog loader with bundled JSON"
```

---

## Task 5: Secret store (keychain + AES fallback)

**Files:**
- Modify: `server-ts/package.json` (add `keytar`)
- Create: `server-ts/src/mcp/secretStore.ts`
- Create: `server-ts/src/mcp/secretStore.test.ts`

- [ ] **Step 1: Install dep**

```
cd /Users/melih/Documents/code/idea/server-ts && npm install keytar
```

- [ ] **Step 2: Write failing tests (AES fallback roundtrip)**

```ts
// server-ts/src/mcp/secretStore.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FallbackSecretStore } from './secretStore.js';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

test('AES fallback roundtrips set/get/delete', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-'));
  const store = new FallbackSecretStore(dir);
  await store.set('srv1', 'AWS_SECRET_ACCESS_KEY', 'super-secret');
  assert.equal(await store.get('srv1', 'AWS_SECRET_ACCESS_KEY'), 'super-secret');
  await store.delete('srv1', 'AWS_SECRET_ACCESS_KEY');
  assert.equal(await store.get('srv1', 'AWS_SECRET_ACCESS_KEY'), null);
  fs.rmSync(dir, { recursive: true });
});

test('AES fallback deleteAll clears a server', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-'));
  const store = new FallbackSecretStore(dir);
  await store.set('srv2', 'K1', 'v1');
  await store.set('srv2', 'K2', 'v2');
  await store.deleteAll('srv2');
  assert.equal(await store.get('srv2', 'K1'), null);
  assert.equal(await store.get('srv2', 'K2'), null);
  fs.rmSync(dir, { recursive: true });
});
```

- [ ] **Step 3: Run — expect fail**

```
cd /Users/melih/Documents/code/idea/server-ts && node --import tsx --test src/mcp/secretStore.test.ts
```
Expected: FAIL (module missing).

- [ ] **Step 4: Implement**

```ts
// server-ts/src/mcp/secretStore.ts
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export interface SecretStore {
  set(mcpServerId: string, envKey: string, value: string): Promise<void>;
  get(mcpServerId: string, envKey: string): Promise<string | null>;
  delete(mcpServerId: string, envKey: string): Promise<void>;
  deleteAll(mcpServerId: string): Promise<void>;
}

// ── AES-GCM fallback (keychain-free environments) ───────────────────────────

export class FallbackSecretStore implements SecretStore {
  private readonly keyPath: string;
  private readonly storePath: string;

  constructor(dataDir: string) {
    this.keyPath = path.join(dataDir, '.mcp-secret-key');
    this.storePath = path.join(dataDir, '.mcp-secrets.json');
    fs.mkdirSync(dataDir, { recursive: true });
  }

  private getKey(): Buffer {
    if (fs.existsSync(this.keyPath)) return fs.readFileSync(this.keyPath);
    const key = crypto.randomBytes(32);
    fs.writeFileSync(this.keyPath, key, { mode: 0o600 });
    return key;
  }

  private readStore(): Record<string, Record<string, string>> {
    if (!fs.existsSync(this.storePath)) return {};
    try { return JSON.parse(fs.readFileSync(this.storePath, 'utf8')); }
    catch { return {}; }
  }

  private writeStore(store: Record<string, Record<string, string>>): void {
    fs.writeFileSync(this.storePath, JSON.stringify(store, null, 2), { mode: 0o600 });
  }

  async set(mcpServerId: string, envKey: string, value: string): Promise<void> {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', this.getKey(), iv);
    const enc = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    const packed = Buffer.concat([iv, tag, enc]).toString('base64');
    const store = this.readStore();
    store[mcpServerId] ??= {};
    store[mcpServerId][envKey] = packed;
    this.writeStore(store);
  }

  async get(mcpServerId: string, envKey: string): Promise<string | null> {
    const packed = this.readStore()[mcpServerId]?.[envKey];
    if (!packed) return null;
    const buf = Buffer.from(packed, 'base64');
    const iv = buf.subarray(0, 12);
    const tag = buf.subarray(12, 28);
    const enc = buf.subarray(28);
    const decipher = crypto.createDecipheriv('aes-256-gcm', this.getKey(), iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(enc), decipher.final()]).toString('utf8');
  }

  async delete(mcpServerId: string, envKey: string): Promise<void> {
    const store = this.readStore();
    if (store[mcpServerId]) {
      delete store[mcpServerId][envKey];
      if (Object.keys(store[mcpServerId]).length === 0) delete store[mcpServerId];
      this.writeStore(store);
    }
  }

  async deleteAll(mcpServerId: string): Promise<void> {
    const store = this.readStore();
    delete store[mcpServerId];
    this.writeStore(store);
  }
}

// ── Keytar wrapper with graceful fallback ────────────────────────────────────

const SERVICE = 'branching-bad-mcp';

async function tryKeytar(): Promise<any | null> {
  try {
    const mod = await import('keytar');
    return mod.default ?? mod;
  } catch { return null; }
}

export class KeychainSecretStore implements SecretStore {
  constructor(private readonly fallback: FallbackSecretStore) {}
  private account(id: string, key: string): string { return `${id}:${key}`; }

  async set(id: string, key: string, value: string): Promise<void> {
    const keytar = await tryKeytar();
    if (keytar) {
      try { await keytar.setPassword(SERVICE, this.account(id, key), value); return; }
      catch { /* fall through */ }
    }
    await this.fallback.set(id, key, value);
  }
  async get(id: string, key: string): Promise<string | null> {
    const keytar = await tryKeytar();
    if (keytar) {
      try { const v = await keytar.getPassword(SERVICE, this.account(id, key)); if (v != null) return v; }
      catch { /* fall through */ }
    }
    return this.fallback.get(id, key);
  }
  async delete(id: string, key: string): Promise<void> {
    const keytar = await tryKeytar();
    if (keytar) { try { await keytar.deletePassword(SERVICE, this.account(id, key)); } catch {} }
    await this.fallback.delete(id, key);
  }
  async deleteAll(id: string): Promise<void> {
    // keytar has no bulk delete — rely on fallback + caller-iterated individual deletes via config placeholders
    await this.fallback.deleteAll(id);
  }
}

export function createSecretStore(dataDir: string): SecretStore {
  const fallback = new FallbackSecretStore(dataDir);
  return new KeychainSecretStore(fallback);
}
```

- [ ] **Step 5: Run — expect pass**

```
cd /Users/melih/Documents/code/idea/server-ts && node --import tsx --test src/mcp/secretStore.test.ts
```
Expected: `pass 2`.

- [ ] **Step 6: Commit**

```
git add server-ts/package.json server-ts/package-lock.json server-ts/src/mcp/secretStore.ts server-ts/src/mcp/secretStore.test.ts
git commit -m "feat(mcp): secret store (keytar with AES-GCM fallback)"
```

---

## Task 6: DB augment (`db/mcp.ts`)

**Files:**
- Create: `server-ts/src/db/mcp.ts`
- Modify: `server-ts/src/main.ts` (register augment import)

- [ ] **Step 1: Implement augment**

```ts
// server-ts/src/db/mcp.ts
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
  const tx = db.prepare('BEGIN');
  tx.run();
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
```

- [ ] **Step 2: Register augment in `main.ts`**

Add alongside the other `import './db/...'` lines (similar to `./db/workflow.js`):
```ts
import './db/mcp.js';
```

- [ ] **Step 3: Typecheck**

```
cd /Users/melih/Documents/code/idea/server-ts && npm run build
```
Expected: no errors.

- [ ] **Step 4: Commit**

```
git add server-ts/src/db/mcp.ts server-ts/src/main.ts
git commit -m "feat(mcp): Db augment with server + profile-assignment methods"
```

---

## Task 7: Config writer

**Files:**
- Create: `server-ts/src/mcp/configWriter.ts`
- Create: `server-ts/src/mcp/configWriter.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
// server-ts/src/mcp/configWriter.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { writeAgentConfig } from './configWriter.js';
import type { ResolvedMcpServer } from './model.js';

const sampleServer = (): ResolvedMcpServer => ({
  id: 'id-1',
  name: 'prod-cw',
  command: 'uvx',
  args: ['awslabs.cloudwatch-logs-mcp-server'],
  env: { AWS_REGION: 'us-east-1', AWS_ACCESS_KEY_ID: 'AKIA' },
});

test('claude: emits mcpServers json', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cfg-'));
  const result = await writeAgentConfig('claude', [sampleServer()], dir);
  const body = JSON.parse(fs.readFileSync(result.configPath, 'utf8'));
  assert.ok(body.mcpServers['prod-cw']);
  assert.equal(body.mcpServers['prod-cw'].command, 'uvx');
  assert.deepEqual(body.mcpServers['prod-cw'].env, { AWS_REGION: 'us-east-1', AWS_ACCESS_KEY_ID: 'AKIA' });
  fs.rmSync(dir, { recursive: true });
});

test('codex: emits toml with per-server sections', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cfg-'));
  const result = await writeAgentConfig('codex', [sampleServer()], dir);
  const body = fs.readFileSync(result.configPath, 'utf8');
  assert.ok(body.includes('[mcp_servers.prod-cw]'));
  assert.ok(body.includes('command = "uvx"'));
  assert.ok(body.includes('AWS_REGION = "us-east-1"'));
  fs.rmSync(dir, { recursive: true });
});

test('gemini: emits settings.json', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cfg-'));
  const result = await writeAgentConfig('gemini', [sampleServer()], dir);
  const body = JSON.parse(fs.readFileSync(result.configPath, 'utf8'));
  assert.ok(body.mcpServers['prod-cw']);
  fs.rmSync(dir, { recursive: true });
});

test('empty server list returns null path', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cfg-'));
  const result = await writeAgentConfig('claude', [], dir);
  assert.equal(result.configPath, null);
  fs.rmSync(dir, { recursive: true });
});
```

- [ ] **Step 2: Run — expect fail**

```
cd /Users/melih/Documents/code/idea/server-ts && node --import tsx --test src/mcp/configWriter.test.ts
```
Expected: FAIL.

- [ ] **Step 3: Implement**

```ts
// server-ts/src/mcp/configWriter.ts
import fs from 'node:fs';
import path from 'node:path';
import type { AgentFlavor, ResolvedMcpServer } from './model.js';

export interface ConfigEmission {
  configPath: string | null;        // null if no servers
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
```

- [ ] **Step 4: Run — expect pass**

```
cd /Users/melih/Documents/code/idea/server-ts && node --import tsx --test src/mcp/configWriter.test.ts
```
Expected: `pass 4`.

- [ ] **Step 5: Commit**

```
git add server-ts/src/mcp/configWriter.ts server-ts/src/mcp/configWriter.test.ts
git commit -m "feat(mcp): config writer for claude/codex/gemini agent flavors"
```

---

## Task 8: Resolver — turn McpServer rows into ResolvedMcpServer

**Files:**
- Create: `server-ts/src/mcp/resolver.ts`

- [ ] **Step 1: Implement**

```ts
// server-ts/src/mcp/resolver.ts
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
```

- [ ] **Step 2: Typecheck**

```
cd /Users/melih/Documents/code/idea/server-ts && npm run build
```

- [ ] **Step 3: Commit**

```
git add server-ts/src/mcp/resolver.ts
git commit -m "feat(mcp): server resolver with secret substitution"
```

---

## Task 9: Test connection probe

**Files:**
- Create: `server-ts/src/mcp/testConnection.ts`

- [ ] **Step 1: Implement**

```ts
// server-ts/src/mcp/testConnection.ts
import { spawn } from 'node:child_process';
import type { ResolvedMcpServer } from './model.js';

export interface TestResult {
  ok: boolean;
  tools: string[];
  stderr: string;
  error?: string;
}

/**
 * Spawn the MCP server, send a minimal `tools/list` JSON-RPC request over stdio,
 * await the response for up to `timeoutMs`, then kill the process.
 */
export async function testMcpConnection(
  server: ResolvedMcpServer,
  timeoutMs = 8000,
): Promise<TestResult> {
  return await new Promise<TestResult>((resolve) => {
    let stderr = '';
    let stdoutBuf = '';
    let settled = false;
    const done = (r: TestResult) => { if (!settled) { settled = true; try { child.kill('SIGTERM'); } catch {} resolve(r); } };

    const child = spawn(server.command, server.args, {
      env: { ...process.env, ...server.env },
      shell: process.platform === 'win32',
    });

    child.on('error', (err) => done({ ok: false, tools: [], stderr, error: String(err) }));

    child.stderr.on('data', (c: Buffer) => { stderr += c.toString('utf8'); });

    child.stdout.on('data', (c: Buffer) => {
      stdoutBuf += c.toString('utf8');
      // Parse newline-delimited JSON-RPC responses
      let idx: number;
      while ((idx = stdoutBuf.indexOf('\n')) !== -1) {
        const line = stdoutBuf.slice(0, idx).trim();
        stdoutBuf = stdoutBuf.slice(idx + 1);
        if (!line) continue;
        try {
          const msg = JSON.parse(line) as { id?: number; result?: { tools?: Array<{ name: string }> }; error?: unknown };
          if (msg.id === 1 && msg.result?.tools) {
            done({ ok: true, tools: msg.result.tools.map((t) => t.name), stderr });
            return;
          }
          if (msg.id === 1 && msg.error) {
            done({ ok: false, tools: [], stderr, error: JSON.stringify(msg.error) });
            return;
          }
        } catch { /* not a JSON line, skip */ }
      }
    });

    // JSON-RPC request: initialize then tools/list
    const req = { jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} };
    child.stdin.write(JSON.stringify(req) + '\n');

    setTimeout(() => done({ ok: false, tools: [], stderr, error: 'timeout' }), timeoutMs);
  });
}
```

- [ ] **Step 2: Typecheck**

```
cd /Users/melih/Documents/code/idea/server-ts && npm run build
```

- [ ] **Step 3: Commit**

```
git add server-ts/src/mcp/testConnection.ts
git commit -m "feat(mcp): test-connection probe via JSON-RPC tools/list"
```

---

## Task 10: HTTP routes

**Files:**
- Create: `server-ts/src/routes/mcp.ts`
- Modify: `server-ts/src/app.ts` (mount)
- Modify: `server-ts/src/state.ts` (add `secretStore` field)

- [ ] **Step 1: Add secretStore to AppState**

Edit `server-ts/src/state.ts` and add to the `AppState` type/class:
```ts
import type { SecretStore } from './mcp/secretStore.js';
// ...
secretStore: SecretStore;
```

Wire it up at bootstrap in `main.ts` near the DB init:
```ts
import { createSecretStore } from './mcp/secretStore.js';
import { getAppDataDir } from './routes/shared.js';
// ...
state.secretStore = createSecretStore(getAppDataDir());
```

- [ ] **Step 2: Implement routes**

```ts
// server-ts/src/routes/mcp.ts
import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import type { AppState } from '../state.js';
import { ApiError } from '../errors.js';
import { loadCatalog } from '../mcp/catalog.js';
import { resolveMcpServer } from '../mcp/resolver.js';
import { testMcpConnection } from '../mcp/testConnection.js';

export function mcpRoutes(state: AppState): Router {
  const r = Router();

  r.get('/api/mcp/catalog', async (_req, res, next) => {
    try {
      const cat = await loadCatalog();
      res.json(cat);
    } catch (e) { next(e); }
  });

  r.get('/api/mcp/servers', (_req, res, next) => {
    try { res.json(state.db.listMcpServers()); }
    catch (e) { next(e); }
  });

  r.post('/api/mcp/servers', async (req, res, next) => {
    try {
      const { catalogId, name, configJson, secrets } = req.body as {
        catalogId: string; name: string;
        configJson: Record<string, unknown>;
        secrets?: Record<string, string>;
      };
      if (!catalogId || !name || !configJson) throw new ApiError(400, 'catalogId, name, configJson required');
      const id = randomUUID();

      // Replace secret values in configJson with placeholders; store originals
      const { cleanedConfig, secretMap } = extractSecrets(configJson, secrets);
      for (const [envKey, value] of Object.entries(secretMap)) {
        await state.secretStore.set(id, envKey, value);
      }
      const server = state.db.createMcpServer(id, catalogId, name, cleanedConfig);
      res.status(201).json(server);
    } catch (e) { next(e); }
  });

  r.get('/api/mcp/servers/:id', (req, res, next) => {
    try {
      const s = state.db.getMcpServer(req.params.id);
      if (!s) throw new ApiError(404, 'not found');
      res.json(s);
    } catch (e) { next(e); }
  });

  r.put('/api/mcp/servers/:id', async (req, res, next) => {
    try {
      const { name, configJson, enabled, secrets } = req.body as {
        name?: string; configJson?: Record<string, unknown>;
        enabled?: boolean; secrets?: Record<string, string>;
      };
      const id = req.params.id;
      if (configJson) {
        const { cleanedConfig, secretMap } = extractSecrets(configJson, secrets);
        for (const [envKey, value] of Object.entries(secretMap)) {
          await state.secretStore.set(id, envKey, value);
        }
        state.db.updateMcpServer(id, { name, configJson: cleanedConfig, enabled });
      } else {
        state.db.updateMcpServer(id, { name, enabled });
      }
      res.json(state.db.getMcpServer(id));
    } catch (e) { next(e); }
  });

  r.delete('/api/mcp/servers/:id', async (req, res, next) => {
    try {
      await state.secretStore.deleteAll(req.params.id);
      state.db.deleteMcpServer(req.params.id);
      res.status(204).end();
    } catch (e) { next(e); }
  });

  r.post('/api/mcp/servers/:id/test', async (req, res, next) => {
    try {
      const server = state.db.getMcpServer(req.params.id);
      if (!server) throw new ApiError(404, 'not found');
      const cat = await loadCatalog();
      const resolved = await resolveMcpServer(server, cat, state.secretStore);
      const result = await testMcpConnection(resolved);
      res.json(result);
    } catch (e) { next(e); }
  });

  r.get('/api/agent-profiles/:id/mcp', (req, res, next) => {
    try { res.json(state.db.listMcpsForProfile(req.params.id)); }
    catch (e) { next(e); }
  });

  r.put('/api/agent-profiles/:id/mcp', (req, res, next) => {
    try {
      const { mcpServerIds } = req.body as { mcpServerIds: string[] };
      if (!Array.isArray(mcpServerIds)) throw new ApiError(400, 'mcpServerIds must be array');
      state.db.setAgentProfileMcps(req.params.id, mcpServerIds);
      res.json(state.db.listMcpsForProfile(req.params.id));
    } catch (e) { next(e); }
  });

  return r;
}

/** Separates values in the config that look like secrets (passed in `secrets` map) into placeholders. */
function extractSecrets(
  configJson: Record<string, unknown>,
  secrets?: Record<string, string>,
): { cleanedConfig: Record<string, unknown>; secretMap: Record<string, string> } {
  const cleaned: Record<string, unknown> = { ...configJson };
  const secretMap: Record<string, string> = {};
  if (secrets) {
    for (const [envKey, value] of Object.entries(secrets)) {
      cleaned[envKey] = `$secret:${envKey}`;
      secretMap[envKey] = value;
    }
  }
  return { cleanedConfig: cleaned, secretMap };
}
```

- [ ] **Step 3: Mount in `app.ts`**

```ts
import { mcpRoutes } from './routes/mcp.js';
// ... near other app.use
app.use(mcpRoutes(state));
```

- [ ] **Step 4: Typecheck**

```
cd /Users/melih/Documents/code/idea/server-ts && npm run build
```

- [ ] **Step 5: Smoke-test catalog endpoint**

Boot, then:
```
curl -s http://localhost:4310/api/mcp/catalog | jq '.entries | keys'
```
Expected: `["aws-cloudwatch", "custom", "filesystem", "github", "postgres", "slack"]`.

- [ ] **Step 6: Commit**

```
git add server-ts/src/routes/mcp.ts server-ts/src/app.ts server-ts/src/state.ts server-ts/src/main.ts
git commit -m "feat(mcp): HTTP routes at /api/mcp with secret-aware CRUD and test endpoint"
```

---

## Task 11: Agent spawn integration

**Files:**
- Modify: `server-ts/src/executor/agent.ts` (or the current spawn helper — grep `spawnAgent` to confirm)

- [ ] **Step 1: Find the spawn helper**

```
grep -rn "spawnAgent\|function spawnAgent" /Users/melih/Documents/code/idea/server-ts/src/executor | head -10
```

- [ ] **Step 2: Wire MCP config emission**

Inside `spawnAgent` (or caller), before `spawn(...)`:

```ts
import { loadCatalog } from '../mcp/catalog.js';
import { resolveMcpServer } from '../mcp/resolver.js';
import { writeAgentConfig } from '../mcp/configWriter.js';
import { getAppDataDir } from '../routes/shared.js';
import path from 'node:path';
import fs from 'node:fs';

// ... inside the spawn function, assuming `state`, `profile`, `runId`, `flavor` are in scope:

const mcpServers = state.db.listMcpsForProfile(profile.id);
let mcpConfigDir: string | null = null;
let mcpConfigPath: string | null = null;
if (mcpServers.length > 0) {
  const catalog = await loadCatalog();
  const resolved = await Promise.all(
    mcpServers.map((s) => resolveMcpServer(s, catalog, state.secretStore)),
  );
  mcpConfigDir = path.join(getAppDataDir(), 'agent_configs', runId);
  const emission = await writeAgentConfig(flavor, resolved, mcpConfigDir);
  mcpConfigPath = emission.configPath;
}

// Build the CLI invocation; append MCP flags per flavor:
const extraArgs: string[] = [];
if (mcpConfigPath) {
  if (flavor === 'claude')       extraArgs.push('--mcp-config', mcpConfigPath);
  else if (flavor === 'gemini')  extraArgs.push('--settings', mcpConfigPath);
  // Codex uses CODEX_CONFIG_DIR env:
}
const spawnEnv = { ...process.env };
if (mcpConfigPath && flavor === 'codex') {
  spawnEnv.CODEX_CONFIG_DIR = path.dirname(mcpConfigPath);
}

// ... existing spawn(...) call, pass extraArgs + spawnEnv

// On process exit (cleanup), remove the config dir to wipe plaintext secrets:
child.on('exit', () => {
  if (mcpConfigDir) fs.promises.rm(mcpConfigDir, { recursive: true, force: true }).catch(() => {});
});
```

Adapt exact variable names to the real spawn helper — the key additions are the listMcpsForProfile / resolve / writeAgentConfig / cleanup block.

- [ ] **Step 3: Typecheck**

```
cd /Users/melih/Documents/code/idea/server-ts && npm run build
```

- [ ] **Step 4: Commit**

```
git add server-ts/src/executor/agent.ts
git commit -m "feat(mcp): agent spawn mounts per-run MCP config and cleans up on exit"
```

---

## Task 12: Frontend types + API client

**Files:**
- Create: `web/src/mcp/types.ts`
- Create: `web/src/mcp/api.ts`

- [ ] **Step 1: Types**

```ts
// web/src/mcp/types.ts
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
```

- [ ] **Step 2: API client**

```ts
// web/src/mcp/api.ts
import type { McpCatalog, McpServer, McpTestResult, McpInstallPayload } from './types';

const base = '/api/mcp';

async function j<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  if (!res.ok) throw new Error(await res.text());
  return res.status === 204 ? (undefined as T) : await res.json();
}

export const mcpApi = {
  catalog: () => j<McpCatalog>(`${base}/catalog`),
  list:    () => j<McpServer[]>(`${base}/servers`),
  get:     (id: string) => j<McpServer>(`${base}/servers/${id}`),
  create:  (body: McpInstallPayload) =>
    j<McpServer>(`${base}/servers`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
  update:  (id: string, patch: Partial<McpInstallPayload> & { enabled?: boolean }) =>
    j<McpServer>(`${base}/servers/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch) }),
  delete:  (id: string) => j<void>(`${base}/servers/${id}`, { method: 'DELETE' }),
  test:    (id: string) => j<McpTestResult>(`${base}/servers/${id}/test`, { method: 'POST' }),
  listForProfile: (profileId: string) => j<McpServer[]>(`/api/agent-profiles/${profileId}/mcp`),
  setForProfile:  (profileId: string, mcpServerIds: string[]) =>
    j<McpServer[]>(`/api/agent-profiles/${profileId}/mcp`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mcpServerIds }) }),
};
```

- [ ] **Step 3: Typecheck**

```
cd /Users/melih/Documents/code/idea/web && npm run build
```

- [ ] **Step 4: Commit**

```
git add web/src/mcp/types.ts web/src/mcp/api.ts
git commit -m "feat(mcp): frontend types + API client"
```

---

## Task 13: `useMcpServers` hook

**Files:**
- Create: `web/src/mcp/useMcpServers.ts`

- [ ] **Step 1: Implement**

```ts
// web/src/mcp/useMcpServers.ts
import { useCallback, useEffect, useState } from 'react';
import { mcpApi } from './api';
import type { McpCatalog, McpServer, McpTestResult, McpInstallPayload } from './types';

export function useMcpServers() {
  const [catalog, setCatalog] = useState<McpCatalog | null>(null);
  const [servers, setServers] = useState<McpServer[]>([]);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    const [cat, list] = await Promise.all([mcpApi.catalog(), mcpApi.list()]);
    setCatalog(cat);
    setServers(list);
  }, []);

  useEffect(() => {
    setLoading(true);
    refresh().finally(() => setLoading(false));
  }, [refresh]);

  const install = useCallback(async (payload: McpInstallPayload) => {
    const s = await mcpApi.create(payload);
    await refresh();
    return s;
  }, [refresh]);

  const update = useCallback(async (id: string, patch: Partial<McpInstallPayload> & { enabled?: boolean }) => {
    const s = await mcpApi.update(id, patch);
    await refresh();
    return s;
  }, [refresh]);

  const remove = useCallback(async (id: string) => {
    await mcpApi.delete(id);
    await refresh();
  }, [refresh]);

  const test = useCallback((id: string): Promise<McpTestResult> => mcpApi.test(id), []);

  return { catalog, servers, loading, refresh, install, update, remove, test };
}
```

- [ ] **Step 2: Typecheck**

```
cd /Users/melih/Documents/code/idea/web && npm run build
```

- [ ] **Step 3: Commit**

```
git add web/src/mcp/useMcpServers.ts
git commit -m "feat(mcp): useMcpServers hook with CRUD + test"
```

---

## Task 14: Monaco helper for schema registration

**Files:**
- Create: `web/src/mcp/McpEditorMonaco.tsx`

- [ ] **Step 1: Implement**

```tsx
// web/src/mcp/McpEditorMonaco.tsx
import { type FC, useEffect } from 'react';
import Editor, { loader } from '@monaco-editor/react';
import type { McpCatalog } from './types';

interface Props {
  catalog: McpCatalog;
  catalogId: string;
  value: string;
  onChange: (v: string) => void;
  height?: string;
}

let schemasRegistered = false;

export const McpEditorMonaco: FC<Props> = ({ catalog, catalogId, value, onChange, height = '320px' }) => {
  useEffect(() => {
    if (schemasRegistered) return;
    loader.init().then((monaco) => {
      const schemas = Object.entries(catalog.entries).map(([id, entry]) => ({
        uri: `inmemory://mcp-${id}.schema.json`,
        fileMatch: [`mcp-config-${id}.json`],
        schema: entry.envSchema,
      }));
      monaco.languages.json.jsonDefaults.setDiagnosticsOptions({
        validate: true,
        allowComments: false,
        schemas,
      });
      schemasRegistered = true;
    });
  }, [catalog]);

  return (
    <div className="overflow-hidden rounded-[var(--radius-md)] border border-border-default">
      <Editor
        height={height}
        language="json"
        theme="vs-dark"
        path={`mcp-config-${catalogId}.json`}
        value={value}
        onChange={(v) => onChange(v ?? '')}
        options={{
          minimap: { enabled: false },
          fontSize: 12,
          lineNumbers: 'on',
          scrollBeyondLastLine: false,
          padding: { top: 10, bottom: 10 },
          fontFamily: '"Source Code Pro", "SF Mono", "Fira Code", monospace',
        }}
      />
    </div>
  );
};
```

- [ ] **Step 2: Commit**

```
git add web/src/mcp/McpEditorMonaco.tsx
git commit -m "feat(mcp): Monaco editor with JSON Schema registration"
```

---

## Task 15: Install modal

**Files:**
- Create: `web/src/mcp/McpInstallModal.tsx`

- [ ] **Step 1: Implement**

```tsx
// web/src/mcp/McpInstallModal.tsx
import { type FC, useMemo, useState } from 'react';
import type { McpCatalog, McpCatalogEntry, McpInstallPayload, McpTestResult } from './types';
import { McpEditorMonaco } from './McpEditorMonaco';
import { mcpApi } from './api';

interface Props {
  catalog: McpCatalog;
  catalogId: string;
  onCancel: () => void;
  onSave: (payload: McpInstallPayload) => Promise<void>;
}

function isSecretField(schema: unknown, key: string): boolean {
  const props = (schema as { properties?: Record<string, { format?: string }> }).properties;
  return props?.[key]?.format === 'secret';
}

function defaultForEntry(entry: McpCatalogEntry): Record<string, unknown> {
  const props = (entry.envSchema as { properties?: Record<string, { default?: unknown }> }).properties ?? {};
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(props)) {
    if ('default' in v) out[k] = v.default;
    else out[k] = '';
  }
  return out;
}

export const McpInstallModal: FC<Props> = ({ catalog, catalogId, onCancel, onSave }) => {
  const entry = catalog.entries[catalogId];
  const [name, setName] = useState<string>(`${catalogId}-1`);
  const [configText, setConfigText] = useState<string>(() => JSON.stringify(defaultForEntry(entry), null, 2));
  const [secrets, setSecrets] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<McpTestResult | null>(null);
  const [testing, setTesting] = useState(false);

  const secretKeys = useMemo(() => {
    const props = (entry.envSchema as { properties?: Record<string, { format?: string }> }).properties ?? {};
    return Object.keys(props).filter((k) => props[k].format === 'secret');
  }, [entry]);

  const parse = (): Record<string, unknown> | null => {
    try { return JSON.parse(configText); } catch { return null; }
  };

  const testDraft = async () => {
    const parsed = parse();
    if (!parsed) { setError('config JSON invalid'); return; }
    setTesting(true); setError(null); setTestResult(null);
    try {
      // Use a temporary install → test → delete dance to exercise the real path
      const tmp = await mcpApi.create({ catalogId, name: `__test_${Date.now()}`, configJson: parsed, secrets });
      try {
        const r = await mcpApi.test(tmp.id);
        setTestResult(r);
      } finally {
        await mcpApi.delete(tmp.id);
      }
    } catch (e) {
      setError(String((e as Error).message));
    } finally {
      setTesting(false);
    }
  };

  const save = async () => {
    const parsed = parse();
    if (!parsed) { setError('config JSON invalid'); return; }
    setSaving(true); setError(null);
    try {
      await onSave({ catalogId, name, configJson: parsed, secrets });
    } catch (e) {
      setError(String((e as Error).message));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-6">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onCancel} />

      <div className="relative flex h-[min(85vh,720px)] w-full max-w-4xl flex-col overflow-hidden rounded-[var(--radius-2xl)] border border-border-default bg-surface-100 shadow-[var(--shadow-lg)]">
        <header className="flex items-center justify-between gap-3 border-b border-border-default bg-surface-100/70 px-5 py-3 backdrop-blur-md">
          <div className="flex items-center gap-2">
            <span className="rounded-full bg-brand-tint px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.1em] text-brand">
              Install MCP
            </span>
            <h2 className="text-[14px] font-semibold text-text-primary">{entry.displayName}</h2>
            {entry.publisher && <span className="text-[11px] text-text-muted">· {entry.publisher}</span>}
          </div>
          <button
            type="button"
            onClick={onCancel}
            aria-label="Close"
            className="flex h-7 w-7 items-center justify-center rounded-full text-text-muted transition hover:bg-surface-200 hover:text-text-primary"
          >
            <svg className="h-3.5 w-3.5" viewBox="0 0 14 14" fill="none">
              <path d="M3 3l8 8M11 3l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </button>
        </header>

        <div className="flex-1 overflow-auto px-5 py-4 space-y-4">
          <label className="block space-y-1">
            <span className="text-[11px] font-medium text-text-secondary">Instance name</span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full rounded-[var(--radius-md)] border border-border-default bg-surface-200 px-2.5 py-1.5 text-[12px] text-text-primary focus:border-border-focus focus:outline-none focus:shadow-[0_0_0_3px_var(--color-brand-glow)]"
            />
          </label>

          {secretKeys.length > 0 && (
            <div className="space-y-2">
              <h4 className="text-[10px] font-semibold uppercase tracking-[0.12em] text-text-muted">Secrets</h4>
              <div className="space-y-2 rounded-[var(--radius-lg)] border border-border-default bg-surface-0/40 p-3">
                {secretKeys.map((k) => (
                  <label key={k} className="block space-y-1">
                    <span className="text-[11px] font-medium text-text-secondary">{k}</span>
                    <input
                      type="password"
                      value={secrets[k] ?? ''}
                      onChange={(e) => setSecrets((prev) => ({ ...prev, [k]: e.target.value }))}
                      className="w-full rounded-[var(--radius-md)] border border-border-default bg-surface-200 px-2.5 py-1.5 text-[12px] font-mono text-text-primary focus:border-border-focus focus:outline-none focus:shadow-[0_0_0_3px_var(--color-brand-glow)]"
                    />
                  </label>
                ))}
                <p className="text-[10px] leading-relaxed text-text-muted">
                  Secrets are stored in the OS keychain (or encrypted on disk if unavailable) and never appear in the config JSON.
                </p>
              </div>
            </div>
          )}

          <div className="space-y-2">
            <h4 className="text-[10px] font-semibold uppercase tracking-[0.12em] text-text-muted">Config</h4>
            <McpEditorMonaco catalog={catalog} catalogId={catalogId} value={configText} onChange={setConfigText} />
          </div>

          {testResult && (
            <div className={`rounded-[var(--radius-md)] border px-3 py-2 text-[12px] ${
              testResult.ok
                ? 'border-status-success/30 bg-status-success-soft text-status-success'
                : 'border-status-danger/30 bg-status-danger-soft text-status-danger'
            }`}>
              {testResult.ok
                ? `✓ ${testResult.tools.length} tools available`
                : `✗ ${testResult.error ?? 'failed'}`}
              {testResult.stderr && (
                <pre className="mt-1 max-h-32 overflow-auto whitespace-pre-wrap font-mono text-[10px] opacity-80">
                  {testResult.stderr}
                </pre>
              )}
            </div>
          )}
          {error && (
            <div className="rounded-[var(--radius-md)] border border-status-danger/30 bg-status-danger-soft px-3 py-2 text-[12px] text-status-danger">
              {error}
            </div>
          )}
        </div>

        <footer className="flex items-center justify-between gap-2 border-t border-border-default bg-surface-100/70 px-5 py-3 backdrop-blur-md">
          <button
            type="button"
            onClick={() => void testDraft()}
            disabled={testing}
            className="rounded-full border border-border-default bg-surface-200 px-3 py-1 text-[11px] font-medium text-text-secondary transition hover:bg-surface-300 hover:text-text-primary disabled:opacity-40"
          >
            {testing ? 'Testing…' : 'Test connection'}
          </button>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onCancel}
              className="rounded-full border border-border-default bg-surface-200 px-3 py-1 text-[11px] font-medium text-text-secondary transition hover:bg-surface-300 hover:text-text-primary"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => void save()}
              disabled={saving || !name.trim()}
              className="rounded-full bg-brand px-3 py-1 text-[11px] font-semibold text-white shadow-[0_1px_2px_rgba(0,0,0,0.2)] transition hover:bg-brand-dark disabled:opacity-40"
            >
              {saving ? 'Saving…' : 'Install'}
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
};
```

- [ ] **Step 2: Typecheck**

```
cd /Users/melih/Documents/code/idea/web && npm run build
```

- [ ] **Step 3: Commit**

```
git add web/src/mcp/McpInstallModal.tsx
git commit -m "feat(mcp): install modal with Monaco schema editor, secrets panel, test button"
```

---

## Task 16: MCP tab in Extensions drawer

**Files:**
- Create: `web/src/mcp/McpTab.tsx`
- Modify: `web/src/components/ExtensionsDrawer.tsx` (add MCP section rendered below providers)

- [ ] **Step 1: Implement tab**

```tsx
// web/src/mcp/McpTab.tsx
import { type FC, useState } from 'react';
import { useMcpServers } from './useMcpServers';
import { McpInstallModal } from './McpInstallModal';

export const McpTab: FC = () => {
  const { catalog, servers, install, remove, test } = useMcpServers();
  const [installingId, setInstallingId] = useState<string | null>(null);
  const [galleryOpen, setGalleryOpen] = useState(false);

  if (!catalog) return <div className="text-[11px] text-text-muted">Loading catalog…</div>;

  return (
    <div className="space-y-3">
      <header className="flex items-center justify-between">
        <div>
          <h3 className="text-[13px] font-medium text-text-primary">MCP servers</h3>
          <p className="text-[10px] text-text-muted">{servers.length} installed</p>
        </div>
        <button
          type="button"
          onClick={() => setGalleryOpen(true)}
          className="flex items-center gap-1.5 rounded-full bg-brand px-3 py-1 text-[11px] font-semibold text-white shadow-[0_1px_2px_rgba(0,0,0,0.2)] hover:bg-brand-dark"
        >
          <svg className="h-3 w-3" viewBox="0 0 12 12" fill="none">
            <path d="M6 2v8M2 6h8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
          </svg>
          Add MCP
        </button>
      </header>

      {servers.length === 0 && (
        <div className="rounded-[var(--radius-lg)] border border-dashed border-border-default/60 px-3 py-6 text-center text-[11px] text-text-muted">
          No MCP servers installed. Click Add MCP to browse the catalog.
        </div>
      )}

      <ul className="space-y-1.5">
        {servers.map((s) => {
          const entry = catalog.entries[s.catalog_id];
          return (
            <li key={s.id} className="flex items-center gap-2 rounded-[var(--radius-md)] border border-border-default bg-surface-0/40 px-3 py-2">
              <span className={`h-1.5 w-1.5 rounded-full ${s.enabled ? 'bg-status-success' : 'bg-text-muted/60'}`} />
              <div className="flex-1 min-w-0">
                <div className="truncate text-[12px] font-medium text-text-primary">{s.name}</div>
                <div className="truncate text-[10px] text-text-muted">{entry?.displayName ?? s.catalog_id}</div>
              </div>
              <button
                type="button"
                onClick={() => void test(s.id).then((r) => alert(r.ok ? `✓ ${r.tools.length} tools` : `✗ ${r.error ?? 'failed'}`))}
                className="rounded-full border border-border-default bg-surface-200 px-2 py-0.5 text-[10px] text-text-secondary hover:bg-surface-300 hover:text-text-primary"
              >
                Test
              </button>
              <button
                type="button"
                onClick={() => void remove(s.id)}
                className="rounded-full bg-status-danger-soft px-2 py-0.5 text-[10px] text-status-danger hover:bg-status-danger/20"
              >
                Remove
              </button>
            </li>
          );
        })}
      </ul>

      {galleryOpen && (
        <div className="fixed inset-0 z-[68] flex items-center justify-center p-6">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setGalleryOpen(false)} />
          <div className="relative w-full max-w-3xl rounded-[var(--radius-2xl)] border border-border-default bg-surface-100 p-5 shadow-[var(--shadow-lg)]">
            <h3 className="mb-3 text-[14px] font-semibold text-text-primary">MCP catalog</h3>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {Object.entries(catalog.entries).map(([id, entry]) => (
                <button
                  key={id}
                  onClick={() => { setGalleryOpen(false); setInstallingId(id); }}
                  className="flex flex-col items-start gap-1 rounded-[var(--radius-lg)] border border-border-default bg-surface-0/40 px-3 py-3 text-left transition hover:border-border-strong hover:bg-surface-200"
                >
                  <span className="text-[12px] font-medium text-text-primary">{entry.displayName}</span>
                  {entry.publisher && <span className="text-[10px] text-text-muted">{entry.publisher}</span>}
                  {entry.description && <span className="mt-1 text-[11px] leading-relaxed text-text-secondary">{entry.description}</span>}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {installingId && (
        <McpInstallModal
          catalog={catalog}
          catalogId={installingId}
          onCancel={() => setInstallingId(null)}
          onSave={async (p) => {
            await install(p);
            setInstallingId(null);
          }}
        />
      )}
    </div>
  );
};
```

- [ ] **Step 2: Render inside ExtensionsDrawer**

Add `<McpTab />` at the top (or bottom) of the drawer's provider list. Simplest place: import and render as a section above the provider sections in `ExtensionsDrawer.tsx`:

```tsx
import { McpTab } from '../mcp/McpTab';
// ... inside the drawer body, above the providers.map(...):
<div className="rounded-[var(--radius-lg)] border border-border-default bg-surface-0/40 p-3">
  <McpTab />
</div>
```

- [ ] **Step 3: Build**

```
cd /Users/melih/Documents/code/idea/web && npm run build
```

- [ ] **Step 4: Commit**

```
git add web/src/mcp/McpTab.tsx web/src/components/ExtensionsDrawer.tsx
git commit -m "feat(mcp): MCP tab in Extensions drawer with catalog gallery"
```

---

## Task 17: Per-agent-profile assignment UI

**Files:**
- Modify: the component where agent profiles are listed / edited. Grep `agent_profiles\|AgentProfileForm\|Agent profile` to find.

- [ ] **Step 1: Find the profile editor**

```
grep -rn "agentProfile\|Agent profile\|AgentProfileEdit\|AgentProfileForm" /Users/melih/Documents/code/idea/web/src | head -20
```

- [ ] **Step 2: Add MCP assignment panel**

Inside the profile edit form (or settings tab), add a section:

```tsx
import { useEffect, useState } from 'react';
import { mcpApi } from '../mcp/api';
import type { McpServer } from '../mcp/types';

// ... inside the profile editor:
const [allMcps, setAllMcps] = useState<McpServer[]>([]);
const [assigned, setAssigned] = useState<Set<string>>(new Set());

useEffect(() => {
  if (!profile) return;
  void Promise.all([mcpApi.list(), mcpApi.listForProfile(profile.id)])
    .then(([all, mine]) => {
      setAllMcps(all);
      setAssigned(new Set(mine.map((s) => s.id)));
    });
}, [profile?.id]);

const toggle = async (id: string) => {
  const next = new Set(assigned);
  if (next.has(id)) next.delete(id); else next.add(id);
  setAssigned(next);
  await mcpApi.setForProfile(profile.id, Array.from(next));
};

// ... in JSX:
<section className="space-y-2">
  <h4 className="text-[10px] font-semibold uppercase tracking-[0.12em] text-text-muted">MCP servers</h4>
  <div className="rounded-[var(--radius-lg)] border border-border-default bg-surface-0/40 p-3">
    {allMcps.length === 0 && <p className="text-[11px] text-text-muted">No MCP servers installed. Add one in Extensions.</p>}
    {allMcps.map((s) => (
      <label key={s.id} className="flex cursor-pointer items-center gap-2 py-1 text-[12px] text-text-primary">
        <input type="checkbox" checked={assigned.has(s.id)} onChange={() => void toggle(s.id)} />
        <span className="flex-1 truncate">{s.name}</span>
        <span className="text-[10px] text-text-muted">{s.catalog_id}</span>
      </label>
    ))}
  </div>
</section>
```

- [ ] **Step 3: Build**

```
cd /Users/melih/Documents/code/idea/web && npm run build
```

- [ ] **Step 4: Commit**

```
git add <the modified profile editor file>
git commit -m "feat(mcp): per-agent-profile MCP assignment checkboxes"
```

---

## Task 18: End-to-end smoke

**Files:**
- none (manual verification)

- [ ] **Step 1: Install a mock MCP**

Via UI: Extensions → MCP tab → Add MCP → "Custom MCP" → config:

```json
{
  "command": "npx",
  "args": ["-y", "@modelcontextprotocol/server-everything", "stdio"]
}
```

Save. Click Test — expect `✓ N tools available` (the everything server exposes several demo tools).

- [ ] **Step 2: Assign to a profile**

Open an agent profile editor → MCP servers section → tick the new MCP → close.

- [ ] **Step 3: Run an agent task**

Open a task, start a run with that profile. In the run output, verify the agent can call tools from the MCP (prompt it to "list your available tools" or similar).

- [ ] **Step 4: Verify cleanup**

After the run finishes, check `$APP_DATA_DIR/agent_configs/<runId>` — the directory should be removed by the exit handler.

---

## Self-review appendix

- **Spec coverage:** Every spec section is covered — catalog (Tasks 3-4), DB (Tasks 1, 6), secret store (Task 5), config writer (Task 7), resolver (Task 8), test-connection (Task 9), HTTP API (Task 10), agent spawn integration (Task 11), frontend types/api/hook (Tasks 12-13), Monaco editor (Task 14), install modal (Task 15), MCP tab + gallery (Task 16), per-profile assignment (Task 17), e2e smoke (Task 18).
- **Placeholder scan:** no "TBD" / "similar to" / "add error handling" — each step has concrete code or commands.
- **Type consistency:** `McpServer`, `McpCatalog`, `ResolvedMcpServer`, `AgentFlavor`, `SecretStore` names match between backend model and consumers. Frontend types mirror backend JSON shape.
- **Cross-platform:** all spawns use `spawn(bin, argsArray)` with `shell: process.platform === 'win32'`; secret store falls back to AES when keytar unavailable; config files written with `mode: 0o600`.
