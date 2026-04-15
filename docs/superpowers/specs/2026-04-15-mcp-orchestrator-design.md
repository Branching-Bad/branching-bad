# MCP Orchestrator — Design

**Status:** draft for review
**Date:** 2026-04-15

## Overview

The app currently has hand-rolled providers (Jira, Sentry, PostgreSQL, CloudWatch, SonarQube, Elasticsearch). Each is a TypeScript module under `server-ts/src/provider/` that fetches data and injects pre-formatted context into the agent's prompt. This does not scale: every new service means new code.

The MCP Orchestrator adds a second track: users install **MCP servers** (Model Context Protocol, the Anthropic-led open spec adopted by AWS, GitHub, Slack, Postgres, filesystem, and many community servers), configure them with a schema-driven JSON editor, and attach them per **agent profile**. On run, we emit the correct config file format for each agent CLI (Claude, Codex, Gemini) and mount it — the agent calls MCP tools natively at runtime. No more bespoke integration per service.

Existing custom providers are **not deprecated** — they remain for curated UX (Jira sprint quick switch, Sentry investigate modal, etc.). MCPs complement them.

## Goals (v1)

- **MCP catalog** — bundled JSON manifest with popular entries (AWS CloudWatch Logs, GitHub, Postgres, Filesystem, Slack, Custom).
- **Dynamic config editor** — Monaco with JSON Schema validation + autocomplete + inline errors, driven by each catalog entry's `envSchema` / `argsSchema`.
- **Per-agent-profile assignment** — `agent_profile_mcp` many-to-many. Each profile picks which MCP servers it sees at runtime.
- **Agent-specific config writer** — on spawn, generate the correct format (Claude `mcp.json`, Codex `config.toml`, Gemini `settings.json`) and pass to the agent CLI.
- **Secret handling** — fields marked `format: "secret"` in schema are password inputs + stored encrypted (via OS keychain via `node-keytar` or equivalent; SQLite column encryption fallback on platforms without keychain).
- **Test connection button** — spin up a short-lived MCP process, call `tools/list`, report success + tool count + stderr on failure.
- **Custom MCP entry** — for MCPs not in the catalog, free-form JSON editor with loose schema, user declares command / args / env directly.

## Out of scope (v1)

- Remote-fetched catalog updates (bundled JSON only; future remote fetch possible).
- Multi-instance of the same MCP type with completely different credentials across profiles (can be worked around by naming each instance `prod-cw` / `staging-cw`).
- MCP server sandboxing beyond the OS process boundary — MCPs run as child processes under the user's account, same as script runners in Workflow.
- OAuth flows for MCPs that need browser-based auth. Token-only for v1.
- Runtime tool call logging / replay UI. Agent CLI logs surface tool activity; we don't build a separate viewer.

## Architecture

### Backend — new module `server-ts/src/mcp/`

```
mcp/
  catalog.ts           # load + validate the bundled catalog manifest
  model.ts             # McpServer row type, McpCatalogEntry type
  configWriter.ts      # agent-specific config emission (Claude/Codex/Gemini)
  testConnection.ts    # spawn + tools/list probe
  secretStore.ts       # cross-platform keychain wrapper (node-keytar + SQLite fallback)
```

Each file ≤300 lines (per CLAUDE.md).

### Bundled catalog — `server-ts/mcp-catalog.json`

Versioned JSON shipped with the server. Each entry is a fully declarative manifest:

```jsonc
{
  "version": 1,
  "entries": {
    "aws-cloudwatch": {
      "displayName": "AWS CloudWatch Logs",
      "publisher": "AWS Labs",
      "description": "Query CloudWatch log groups and events",
      "transport": "stdio",
      "command": "uvx",
      "args": ["awslabs.cloudwatch-logs-mcp-server"],
      "docsUrl": "https://github.com/awslabs/mcp",
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
    "github": { /* ... */ },
    "postgres": { /* ... */ },
    "slack": { /* ... */ },
    "filesystem": { /* ... */ },
    "custom": {
      "displayName": "Custom MCP",
      "description": "Any MCP server, declared by hand",
      "transport": "stdio",
      "envSchema": {
        "type": "object",
        "properties": {
          "command": { "type": "string", "title": "Command" },
          "args":    { "type": "array", "items": { "type": "string" }, "title": "Arguments" },
          "env":     { "type": "object", "additionalProperties": { "type": "string" }, "title": "Environment" }
        },
        "required": ["command"]
      }
    }
  }
}
```

Initial `entries` set: `aws-cloudwatch`, `github`, `postgres`, `slack`, `filesystem`, `custom`. Additional can be added by editing the JSON.

### Frontend — `web/src/mcp/`

```
mcp/
  McpTab.tsx           # Extensions drawer → "MCP" tab, catalog gallery + installed list
  McpInstallModal.tsx  # pick catalog entry → Monaco JSON editor + test + save
  McpEditorMonaco.tsx  # wraps @monaco-editor/react with JSON Schema registration
  useMcpServers.ts     # hook: list, create, update, delete, test
  api.ts               # fetch helpers (/api/mcp/*)
```

## Data model

New migration `server-ts/migrations/V21__add_mcp_servers.sql`:

```sql
CREATE TABLE mcp_servers (
  id           TEXT PRIMARY KEY,
  catalog_id   TEXT NOT NULL,              -- 'aws-cloudwatch' | 'github' | 'custom' | ...
  name         TEXT NOT NULL,              -- user alias, e.g. "prod-cw"
  config_json  TEXT NOT NULL,              -- validated against catalog envSchema
  enabled      INTEGER NOT NULL DEFAULT 1,
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL
);

CREATE INDEX idx_mcp_servers_catalog ON mcp_servers(catalog_id);

CREATE TABLE agent_profile_mcp (
  agent_profile_id TEXT NOT NULL,
  mcp_server_id    TEXT NOT NULL,
  PRIMARY KEY (agent_profile_id, mcp_server_id),
  FOREIGN KEY (agent_profile_id) REFERENCES agent_profiles(id) ON DELETE CASCADE,
  FOREIGN KEY (mcp_server_id)    REFERENCES mcp_servers(id)    ON DELETE CASCADE
);

CREATE INDEX idx_agent_profile_mcp_profile ON agent_profile_mcp(agent_profile_id);
```

Secrets are **not stored in `config_json`**. Secret-marked fields are replaced with placeholder tokens (`$secret:<secretId>`) in `config_json`; the real values live either:

1. In OS keychain under `branching-bad.mcp.<secretId>` (via `node-keytar`), OR
2. In a separate `mcp_secrets` table (fallback when keychain unavailable — Linux without gnome-keyring, headless Docker, etc.):

```sql
CREATE TABLE mcp_secrets (
  id            TEXT PRIMARY KEY,
  mcp_server_id TEXT NOT NULL REFERENCES mcp_servers(id) ON DELETE CASCADE,
  env_key       TEXT NOT NULL,
  value_cipher  BLOB NOT NULL,              -- AES-256-GCM with app-bound key
  UNIQUE (mcp_server_id, env_key)
);
```

The app-bound key is derived from `APP_DATA_DIR` + host fingerprint (stable across restarts, not portable across machines — a trade-off against plaintext).

## Config writer (`mcp/configWriter.ts`)

One pure function per agent flavor, all take the same input (list of resolved MCP servers with secrets substituted) and emit the correct format on disk.

### Claude
Path: `$APP_DATA_DIR/agent_configs/<runId>/claude-mcp.json`
```json
{
  "mcpServers": {
    "prod-cw": {
      "command": "uvx",
      "args": ["awslabs.cloudwatch-logs-mcp-server"],
      "env": { "AWS_REGION": "us-east-1", "AWS_ACCESS_KEY_ID": "…" }
    }
  }
}
```
Pass to CLI with `--mcp-config <path>` (Claude Code supports this flag).

### Codex
Path: `$APP_DATA_DIR/agent_configs/<runId>/codex.toml`
```toml
[mcp_servers.prod-cw]
command = "uvx"
args = ["awslabs.cloudwatch-logs-mcp-server"]

[mcp_servers.prod-cw.env]
AWS_REGION = "us-east-1"
AWS_ACCESS_KEY_ID = "…"
```
Pass via `CODEX_CONFIG_DIR` env var pointing to the parent dir.

### Gemini
Path: `$APP_DATA_DIR/agent_configs/<runId>/gemini-settings.json`
```json
{ "mcpServers": { "prod-cw": { /* same shape as Claude */ } } }
```
Pass via `GEMINI_CONFIG_DIR` or `--settings <path>` (pending confirmation during implementation of actual Gemini CLI flag).

Config files are written to a per-run temp dir, mounted into the agent spawn, and **deleted when the run terminates** (the spawned child receives plaintext secrets in env; we minimize on-disk plaintext exposure by cleaning up fast).

## Secret management (`mcp/secretStore.ts`)

Primary: `node-keytar` with service name `branching-bad-mcp`, account = `<mcpServerId>:<envKey>`. Cross-platform: macOS Keychain, Windows Credential Manager, Linux gnome-keyring / kwallet.

Fallback when keytar fails to load (rare — old Linux, certain Docker images):
- AES-256-GCM encryption using a locally-generated key stored at `$APP_DATA_DIR/.mcp-secret-key` (0600 perms). Ciphertext in `mcp_secrets.value_cipher`.

API contract for `secretStore`:
```ts
set(mcpServerId: string, envKey: string, value: string): Promise<void>
get(mcpServerId: string, envKey: string): Promise<string | null>
delete(mcpServerId: string, envKey: string): Promise<void>
deleteAll(mcpServerId: string): Promise<void>
```

`configWriter` calls `secretStore.get` for each `$secret:...` placeholder in `config_json` and inlines into the emitted file.

## HTTP API

All endpoints auth-scoped like the existing provider API.

| Method | Path                                         | Purpose                                              |
| ------ | -------------------------------------------- | ---------------------------------------------------- |
| GET    | `/api/mcp/catalog`                           | returns bundled catalog manifest                     |
| GET    | `/api/mcp/servers`                           | list installed MCP servers                           |
| POST   | `/api/mcp/servers`                           | install (body: catalogId, name, configJson + secrets) |
| GET    | `/api/mcp/servers/:id`                       | fetch single server                                  |
| PUT    | `/api/mcp/servers/:id`                       | update config/secrets                                |
| DELETE | `/api/mcp/servers/:id`                       | uninstall (cascade secrets)                         |
| POST   | `/api/mcp/servers/:id/test`                  | test connection; returns `{ ok, tools: string[], stderr }` |
| GET    | `/api/agent-profiles/:id/mcp`                | list assigned MCPs for a profile                     |
| PUT    | `/api/agent-profiles/:id/mcp`                | replace assignment set `{ mcpServerIds: string[] }`  |

Secrets arrive in `POST` / `PUT` body as a separate object so they can be routed through `secretStore.set` without landing in `config_json`:

```json
{
  "catalogId": "aws-cloudwatch",
  "name": "prod-cw",
  "configJson": {
    "AWS_REGION": "us-east-1",
    "AWS_ACCESS_KEY_ID": "$secret:k1",
    "AWS_SECRET_ACCESS_KEY": "$secret:k2"
  },
  "secrets": {
    "k1": "AKIA…",
    "k2": "xxxxxxxx"
  }
}
```

## UI flows

### Extensions drawer → MCP tab

New tab next to existing provider list. Inside:

1. **Installed section** — cards listing user's MCP servers:
   - Row: catalog icon + name + status dot (enabled/disabled/error) + tool count (from last test) + gear menu (edit / disable / delete).
   - Right-side gear menu disabled if MCP used by ≥1 agent profile.

2. **Add MCP** button → **catalog gallery modal**:
   - Grid of tiles — catalog entries with icon, displayName, publisher, one-line description.
   - Click a tile → `McpInstallModal` opens with the Monaco editor.

3. **Per-agent-profile section** (accessible from each profile's detail):
   - Checkbox list of installed MCPs, toggle to assign.

### `McpInstallModal`

Layout: two-column.

- **Left** — form fields rendered from `envSchema` (non-secret) + secret inputs (password type). Uses our existing SF form primitives. Gives non-expert users a quick path.
- **Right** — Monaco JSON editor with the same schema registered. Changes in the left form sync to Monaco and vice-versa. Power users edit JSON directly.
- **Bottom bar** — "Test connection" button (runs `POST /api/mcp/servers/.../test`, shows result inline: ✓ "12 tools available" or ✗ stderr) + Cancel + Save.
- **Fill template** button near the Monaco editor — pastes the schema's `default` values into the editor.
- Save flow: validate against schema client-side → POST → on success, close.

### Monaco schema registration

```ts
import { loader } from '@monaco-editor/react';

loader.init().then((monaco) => {
  const schemas = catalog.entries.map((e, id) => ({
    uri: `inmemory://mcp-${id}.schema.json`,
    fileMatch: [`mcp-config-${id}.json`],
    schema: e.envSchema,
  }));
  monaco.languages.json.jsonDefaults.setDiagnosticsOptions({
    validate: true,
    schemas,
  });
});
```

Editor `path` prop drives schema match:
```tsx
<Editor language="json" path={`mcp-config-${catalogId}.json`} value={...} onChange={...} />
```

This gives validation squiggles, hover docs, `Ctrl+Space` autocomplete — free.

## Agent spawn integration

Modify `server-ts/src/executor/agent.ts` (or equivalent) spawn helper:

1. Resolve the run's agent profile.
2. `db.listMcpServersForProfile(profileId)` → active MCP servers.
3. For each, call `secretStore.get` for each secret placeholder.
4. `configWriter.write(agentFlavor, resolvedMcps, tmpDir)` → emits file.
5. Pass path / env var to the CLI (`--mcp-config` for Claude, `CODEX_CONFIG_DIR` for Codex, `--settings` for Gemini).
6. On run finalization (`processManager` exit handler), `fs.rm(tmpDir, { recursive: true })` to wipe plaintext config.

Agent profiles without assigned MCPs just skip the config writing step — CLI launches without MCP flags. Zero regression on existing runs.

## Cross-platform

- `node-keytar` works on darwin, win32, and Linux (with libsecret / gnome-keyring). Falls back to the SQLite AES route when unavailable.
- `spawn(bin, argsArray)` for MCP server processes (no `execSync(string)`), `shell: process.platform === 'win32'` for `.cmd` shim handling (`uvx.cmd` on Windows).
- Config paths: `APP_DATA_DIR` cross-platform helper (existing).
- Temp config dir cleanup uses `fs.rm(..., { recursive: true })` with retry on Windows EBUSY.

## Testing

- Unit: `catalog.ts` schema-loading, `configWriter.ts` emission for all 3 agent flavors given a fixed input, `secretStore.ts` roundtrip (`set` → `get` → `delete`).
- Integration: spin up an MCP mock (`@modelcontextprotocol/server-everything`), POST an install, run `test` endpoint, assert `tools[]` non-empty.
- Manual smoke: install AWS CloudWatch MCP against a real test AWS account, run a task that asks Claude to "list recent errors in /aws/lambda/foo", verify agent's tool calls go through the MCP.

## Rollout & migration

1. Ship v1 as **additive**. All existing providers keep working unchanged.
2. Add a gentle "migrate to MCP" hint in each custom provider's settings UI where an official MCP exists (e.g. Postgres, GitHub). User opts in; no auto-migration.
3. Future v2: deprecate the hand-rolled providers that have robust MCP alternatives, keeping only providers with curated UX (Jira sprint switch) as thin shells over MCP calls.

## Open questions

- Should MCP assignment live on `agent_profile` or at a higher level (repo / task)? v1 uses profile to match the existing "profiles own agent config" mental model. Task-level override possible later.
- How aggressive should the "Test connection" button be with firing off secrets to the child process? v1 runs only on explicit click and only during install/edit flow.
- For MCP servers with tool permission prompts (e.g., Claude MCP trust dialog), do we need a first-run "accept trust" step recorded in the app? For v1 rely on the agent CLI's own prompt handling — our side just emits the config.
