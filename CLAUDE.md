# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Local-first, approval-first coding agent with pluggable provider system. Connects to external services (Jira, Sentry, etc.) via a unified provider interface, syncs tasks, generates implementation plans requiring human approval, then launches a git branch and executes. SQLite persistence stored in OS app data directory.

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

Single-binary HTTP server. `main.rs` contains all Axum handlers and route definitions.

#### Core modules
- `models.rs` — All data structs (Repo, Task, Plan, Run, ProviderAccountRow, etc.)
- `planner.rs` — `build_plan()`: walks repo files with walkdir, scores by keyword overlap, produces markdown + structured JSON plan
- `executor.rs` — Git operations: branch creation (`codex/<ISSUE_KEY>-<ts>`), plan artifact saving to `.local-agent/`, diff capture, agent command probing
- `discovery.rs` — Scans PATH for AI agent binaries (codex, claude, gemini, opencode, cursor), reads their config files
- `process_manager.rs` — Manages spawned agent processes
- `msg_store.rs` — Message/event storage for run logs

#### db/ — SQLite module (split into domain files)
- `mod.rs` — Schema init, connection helper, `now_iso()` utility
- `repos.rs` — Repo CRUD
- `tasks.rs` — Task CRUD + state transitions
- `plans.rs` — Plan CRUD + plan actions
- `plan_jobs.rs` — Background plan generation jobs
- `runs.rs` — Run CRUD + event logging
- `agents.rs` — Agent profile + repo agent preference CRUD
- `autostart.rs` — Autostart job queue
- `providers.rs` — Provider accounts, resources, bindings, items CRUD
- `reviews.rs` — Review comments
- `maintenance.rs` — Cleanup/recovery operations

#### provider/ — Pluggable provider system
- `mod.rs` — `Provider` trait, `ProviderRegistry`, `register_all()`, shared types (ProviderMeta, ConnectField, etc.)
- `jira/` — Jira provider (REST API v3 + Agile v1, Basic Auth)
- `sentry/` — Sentry provider (REST API, Auth Token)

Port `4310` (override with `PORT` env var). DB path via `directories` crate (override with `APP_DATA_DIR` env var).

### web/ — React Frontend (React 19, Vite 7, Tailwind CSS v4)

- `App.tsx` — Main component with all UI state and logic
- `api.ts` — Typed `api<T>()` fetch helper for all backend calls
- Two-column layout: left sidebar (repo/extensions/agent config), main area (kanban board + plan approval + run output)
- Vite proxies `/api/*` to the backend in dev mode
- Some UI strings are in Turkish

#### components/
- `ExtensionsDrawer.tsx` — Drawer that dynamically renders provider sections from registry
- `ProviderSettingsModal.tsx` — Modal for provider connection/config, renders connect forms from backend metadata
- `SettingsModal.tsx` — General settings modal
- `KanbanBoard.tsx`, `DetailsSidebar.tsx`, `CreateTaskModal.tsx`, `EditTaskModal.tsx` — Task management UI
- `icons.tsx` — SVG icon components
- `shared.ts` — Shared UI utilities

#### providers/ — Frontend provider registry (mirrors backend pattern)
- `types.ts` — `ProviderUI` type (drawerSection + settingsTab components), `DrawerSectionProps`, `SettingsTabProps`
- `registry.ts` — `registerProviderUI()`, `getProviderUI()`, `getAllProviderUIs()`
- `init.ts` — `initProviders()`: calls each provider's register function at app startup
- `jira/` — Jira drawer section + settings tab
- `sentry/` — Sentry drawer section + settings tab

### reference/vibe-kanban/ — External reference project, not part of the active application

## Adding a New Provider

Follow this checklist — **no changes needed** in `main.rs`, `App.tsx`, `ExtensionsDrawer.tsx`, or `ProviderSettingsModal.tsx`.

### Backend
1. Create `server-rs/src/provider/<name>/` directory
2. Implement the `Provider` trait (meta, validate_credentials, list_resources, sync_items, item_to_task_fields, mask_account)
3. Add `pub fn register(registry: &mut ProviderRegistry)` in the provider module
4. In `server-rs/src/provider/mod.rs`: add `pub mod <name>;` and one line in `register_all()`

### Frontend
1. Create `web/src/providers/<name>/` directory with DrawerSection + index.ts
2. In `web/src/providers/init.ts`: import and call `register<Name>UI()`

## API Routes

All routes under `/api/`. Key groups:
- `/api/repos` — CRUD for local git repositories
- `/api/tasks/*` — Sync, list, create, update, review tasks
- `/api/plans/*` — Create plans, list plans, approve/reject/revise, plan jobs
- `/api/runs/*` — Start runs, get status, stream logs, stop
- `/api/agents/*` — Discover AI agents in PATH, select per-repo profile
- `/api/providers/*` — Generic provider endpoints (connect, accounts, resources, bind, items, sync)
- `/api/bootstrap` — Returns repos + provider accounts + agent profiles in one call
- `/api/pipeline/clear-all` — Reset all pipeline state
- `/api/fs/list` — Filesystem listing for folder picker

## Task State Machine

TODO → PLAN_DRAFTED → PLAN_APPROVED → IN_PROGRESS → IN_REVIEW → DONE/FAILED
With side states: PLAN_REVISE_REQUESTED, PAUSED_FOR_REAPPROVAL, CANCELLED

## SQLite Schema

Tables: `repos`, `tasks`, `plans`, `plan_actions`, `plan_jobs`, `autostart_jobs`, `runs`, `events`, `agent_profiles`, `repo_agent_preferences`, `review_comments`, `provider_accounts`, `provider_resources`, `provider_bindings`, `provider_items`

DB location: macOS `~/Library/Application Support/jira-approval-local-agent/agent.db`, Linux `~/.local/share/jira-approval-local-agent/agent.db`
