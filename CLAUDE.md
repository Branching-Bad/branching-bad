# CLAUDE.md

## Project Overview

Local-first, approval-first coding agent. Pluggable provider system (Jira, Sentry, PostgreSQL, CloudWatch, SonarQube, Elasticsearch). Generates AI plans requiring human approval, then executes in isolated git worktrees. SQLite persistence. Cross-platform (macOS, Linux, Windows).

## Commands

Two self-contained npm projects (`server-ts/` and `web/`). Run commands from inside each.

```bash
# Install (once per project)
cd server-ts && npm install
cd web && npm install

# Dev (two terminals)
cd server-ts && npm run dev    # backend — tsx watch src/main.ts
cd web && npm run dev          # frontend — vite dev server

# Build / type-check
cd server-ts && npm run build  # tsc --noEmit
cd web && npm run build        # tsc -b && vite build
cd web && npm run lint         # eslint .
```

Backend: `:4310`, Frontend: `:5173` (proxies `/api` to backend).

## Architecture

### server-ts/ — Express + ws + better-sqlite3

≤200 lines/file convention. `app.ts` mounts routes, `websocket.ts` handles WS upgrades.

| Directory | Responsibility |
|-----------|---------------|
| `models/` | Data types (barrel re-exported via `models.ts`) |
| `db/` | SQLite — `Db` class with `declare module` augmentation per domain |
| `routes/` | HTTP handlers — each exports `Router` |
| `services/` | Business logic decoupled from routes |
| `executor/` | Git ops (`git-read`, `git-write`, `merge`), agent spawning, shell execution |
| `planner/` | Plan generation, streaming, parsing, validation |
| `provider/` | Provider interface + registry + per-provider folders |

Key files: `state.ts` (AppState), `errors.ts` (ApiError → `toResponse(res)`), `discovery.ts` (agent binary scanning), `processManager.ts` (process lifecycle).

### web/ — React 19 + Vite 7 + Tailwind v4

`App.tsx` is a thin shell — all logic in `hooks/` (one per domain). `providers/` mirrors backend registry (`registerProviderUI`/`getProviderUI`).

## Code Size Limits

| Element       | Ideal   | Max |
|---------------|---------|-----|
| Class         | 100-200 | 300 |
| File          | 150-300 | 400 |
| Method        | 10-20   | 30  |
| Parameters    | 3       | 5   |
| Nesting depth | 2       | 3   |

## Key Patterns

### Agent Profile Resolution (3-tier)

`resolveAgentProfile()` in `routes/shared.ts`: explicit payload → task override → repo default.

### Task State Machine

`TODO → PLAN_GENERATING → PLAN_DRAFTED → PLAN_APPROVED → IN_PROGRESS → IN_REVIEW → DONE/FAILED`

### Cross-Platform

- `spawnSync(bin, argsArray)` — no shell escaping, no `execSync(string)`
- `shell: process.platform === 'win32'` for `.cmd` shim resolution
- `tree-kill` for process tree termination (Windows: `taskkill /T /F`)
- Config paths: Unix `~/` + Windows `%APPDATA%`
- Docker: `toDockerPath()` (`C:\Users\foo` → `/c/Users/foo`)

### Adding a Provider

No changes in `main.ts`, `App.tsx`, `ExtensionsDrawer.tsx`, `ProviderSettingsModal.tsx`.

**Backend:** `server-ts/src/provider/<name>/` → implement `Provider` interface → register in `registerAll()`
**Frontend:** `web/src/providers/<name>/` → DrawerSection + index.ts → register in `init.ts`

### DB Migrations

Add SQL in `db/index.ts` `initSchema()`. Tables: `repos`, `tasks`, `plans`, `plan_actions`, `plan_jobs`, `autostart_jobs`, `runs`, `events`, `agent_profiles`, `repo_agent_preferences`, `review_comments`, `chat_messages`, `provider_accounts`, `provider_resources`, `provider_bindings`, `provider_items`, `repository_rules`

DB location: macOS `~/Library/Application Support/branching-bad/agent.db`, Linux `~/.local/share/branching-bad/agent.db`, Windows `%APPDATA%\branching-bad\agent.db`

Port `4310` (`PORT` env), DB path (`APP_DATA_DIR` env).
