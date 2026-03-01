# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Local-first, approval-first coding agent with pluggable provider system. Connects to external services (Jira, Sentry, PostgreSQL, CloudWatch, etc.) via a unified provider interface, syncs tasks, generates implementation plans requiring human approval, then launches a git branch and executes. SQLite persistence stored in OS app data directory.

## Commands

```bash
# Development (runs Rust backend + Vite frontend concurrently)
npm run dev

# Run only backend or frontend
npm run dev:server          # cargo run --manifest-path server-rs/Cargo.toml
npm run dev:web             # vite dev server (web/)

# Build
npm run build               # builds web + cargo build
npm run typecheck           # web build (type checking)
npm run check:server        # cargo check on server-rs

# Frontend lint
cd web && npx eslint .
```

Backend: http://localhost:4310, Frontend: http://localhost:5173 (proxies /api to backend).

## Architecture

**Monorepo with two main parts:**

### server-rs/ — Rust Backend (Axum + rusqlite)

Single-binary HTTP server. `main.rs` wires together route modules via `.merge()`.

#### Core modules
- `errors.rs` — `ApiError` with `bad_request`, `not_found`, `conflict`, `internal` constructors
- `models.rs` — All data structs (Repo, Task, Plan, Run, AgentProfile, etc.)
- `planner.rs` — `build_plan()`: walks repo, scores files by keyword overlap, produces markdown + structured JSON plan
- `executor.rs` — Git operations: branch, worktree, diff, merge strategies, push, PR via `gh` CLI
- `discovery.rs` — Scans PATH for AI agent binaries, reads config files
- `process_manager.rs` — Manages spawned agent processes
- `msg_store.rs` — Message/event storage for run logs

#### routes/ — HTTP handler modules (each exports `xxx_routes() -> Router<AppState>`)
- `shared.rs` — Shared types and utilities: `resolve_agent_profile` (3-tier resolution), `build_agent_command`, `enqueue_autostart_if_enabled`, etc.
- `runs.rs` — Run lifecycle, WebSocket log streaming, `start_run`, `spawn_resume_run`
- `reviews.rs` — Review submission, apply-to-main (merge strategies), push, PR creation
- `chat.rs` — Chat/follow-up messages with agent profile override support
- `plans.rs` — Plan CRUD, approve/reject/revise, plan jobs
- `tasks.rs` — Task sync, CRUD, pipeline management
- `repos.rs`, `agents.rs`, `autostart.rs`, `health.rs`, `fs.rs`

#### db/ — SQLite module (split by domain: repos, tasks, plans, runs, agents, providers, etc.)

Schema init via refinery embedded migrations. New migrations: add `V{N}__description.sql`, runs automatically at boot.

#### provider/ — Pluggable provider system
- `mod.rs` — `Provider` trait, `ProviderRegistry`, `register_all()`
- `routes.rs` — Generic HTTP handlers (connect, accounts, resources, bind, items, sync)
- Implementations: `jira/`, `sentry/`, `postgres/` (`auto_sync: false`), `cloudwatch/`

Port `4310` (override with `PORT` env var). DB path via `directories` crate (override with `APP_DATA_DIR` env var).

### web/ — React Frontend (React 19, Vite 7, Tailwind CSS v4)

- `App.tsx` — Thin shell (~295 lines): UI state, hook wiring, JSX layout. All domain logic in custom hooks.
- `api.ts` — Typed `api<T>()` fetch helper for all backend calls
- Two-column layout: left sidebar (repo/extensions/agent config), main area (kanban board + plan approval + run output)
- Vite proxies `/api/*` to backend in dev mode. Some UI strings are in Turkish.

#### hooks/ — Domain-specific custom hooks (one per domain, extracted from App.tsx)

`useBootstrap`, `useRepoSelection`, `useTaskState`, `usePlanState`, `useRunState`, `useReviewState` (includes `reviewProfileId`), `useChatState` (includes `chatProfileId`), `useEventStream`, `useWebSocketStream`, `usePolling`. Shared type: `streamTypes.ts`.

#### components/ — Key patterns

- **Shared components**: `AgentProfileSelect` (agent dropdown), `TaskFormFields` (shared form fields for Create/Edit modals), `MergeOptionsBar` (merge strategy + push + PR controls)
- **Main UI**: `KanbanBoard`, `DetailsSidebar` (tab-based: plan/tasklist/run/review)
- **Review**: `DiffReviewPanel`, `DiffReviewModal` (expanded), `DiffViewer`, `InlineCommentEditor`
- **Other**: `ChatPanel`, `LogViewer`/`LogEntry`, `FolderPicker`, `ExtensionsDrawer`, `SettingsModal`, `ProviderSettingsModal`

#### providers/ — Frontend provider registry (mirrors backend)

`registerProviderUI()` / `getProviderUI()` pattern. Init in `init.ts`. Each provider has a drawer section + settings tab.

### reference/vibe-kanban/ — External reference project, not part of the active application

## Key Patterns

### Agent Profile Resolution

All run-triggering endpoints use `resolve_agent_profile()` from `routes/shared.rs` — 3-tier resolution:

1. **Explicit payload** — `profileId` from request body (UI dropdown override)
2. **Task override** — `task.agent_profile_id` (set at task creation/edit)
3. **Repo default** — `repo_agent_preferences` table (set in settings)

Used by: `start_run`, `submit_review`, `send_chat_message`, `dispatch_next_queued_chat`. `start_run` additionally persists explicit selection as repo preference.

### Task State Machine

TODO → PLAN_GENERATING → PLAN_DRAFTED → PLAN_APPROVED → IN_PROGRESS → IN_REVIEW → DONE/FAILED
Side states: PLAN_REVISE_REQUESTED, PAUSED_FOR_REAPPROVAL, CANCELLED

### Adding a New Provider

**No changes needed** in `main.rs`, `App.tsx`, `ExtensionsDrawer.tsx`, or `ProviderSettingsModal.tsx`.

**Backend:**
1. Create `server-rs/src/provider/<name>/`, implement `Provider` trait
2. Override `auto_sync()` → `false` for expensive providers
3. Add `register()` fn, wire in `provider/mod.rs` `register_all()`

**Frontend:**
1. Create `web/src/providers/<name>/` with DrawerSection + index.ts
2. Register in `web/src/providers/init.ts`

## API Routes

All under `/api/`. Key groups: `/api/repos`, `/api/tasks/*`, `/api/plans/*`, `/api/runs/*`, `/api/agents/*`, `/api/providers/*`, `/api/chat/*`, `/api/bootstrap`, `/api/fs/list`, `/api/pipeline/clear-all`

## SQLite Schema

Tables: `repos`, `tasks`, `plans`, `plan_actions`, `plan_jobs`, `autostart_jobs`, `runs`, `events`, `agent_profiles`, `repo_agent_preferences`, `review_comments`, `chat_messages`, `provider_accounts`, `provider_resources`, `provider_bindings`, `provider_items`

DB location: macOS `~/Library/Application Support/jira-approval-local-agent/agent.db`, Linux `~/.local/share/jira-approval-local-agent/agent.db`
