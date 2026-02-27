# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Local-first, approval-first Jira coding agent. Connects to Jira, syncs tasks assigned to the current user, generates implementation plans requiring human approval, then launches a git branch and executes. SQLite persistence stored in OS app data directory.

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
Single-binary HTTP server. All handlers and route definitions live in `main.rs`. Business logic is split across modules:
- `db.rs` — SQLite schema init + all CRUD operations (rusqlite, bundled)
- `models.rs` — All data structs (Repo, JiraAccount, Task, Plan, Run, etc.)
- `jira.rs` — JiraClient: Basic Auth, calls Jira REST API v3 + Agile v1
- `planner.rs` — `build_plan()`: walks repo files with walkdir, scores by keyword overlap, produces markdown + structured JSON plan
- `executor.rs` — Git operations: branch creation (`codex/<ISSUE_KEY>-<ts>`), plan artifact saving to `.local-agent/`, diff capture, agent command probing
- `discovery.rs` — Scans PATH for AI agent binaries (codex, claude, gemini, opencode, cursor), reads their config files

Port `4310` (override with `PORT` env var). DB path via `directories` crate (override with `APP_DATA_DIR` env var).

### web/ — React Frontend (React 19, Vite 7, Tailwind CSS v4)
- `App.tsx` is a single large component (~700 lines) containing all UI state and logic
- Two-column layout: left sidebar (repo/jira/agent config), main area (kanban board + plan approval + run output)
- All API calls through a typed `api<T>()` fetch helper
- Vite proxies `/api/*` to the backend in dev mode
- Some UI strings are in Turkish

### reference/vibe-kanban/ — External reference project, not part of the active application

## API Routes

All routes under `/api/`. Key groups:
- `/api/repos` — CRUD for local git repositories
- `/api/jira/*` — Connect, list accounts, fetch boards, bind repo to board
- `/api/tasks/*` — Sync and list Jira tasks
- `/api/plans/*` — Create plans, list plans, approve/reject/revise actions
- `/api/runs/*` — Start runs, get run status + events
- `/api/agents/*` — Discover AI agents in PATH, select per-repo profile
- `/api/bootstrap` — Returns repos + jira accounts + agent profiles in one call

## Task State Machine

TODO → PLAN_DRAFTED → PLAN_APPROVED → IN_PROGRESS → DONE/FAILED
With side states: PLAN_REVISE_REQUESTED, PAUSED_FOR_REAPPROVAL, CANCELLED

## SQLite Schema

Tables: `repos`, `jira_accounts`, `jira_boards`, `repo_jira_bindings`, `tasks`, `plans`, `plan_actions`, `runs`, `events`, `agent_profiles`, `repo_agent_preferences`

DB location: macOS `~/Library/Application Support/jira-approval-local-agent/agent.db`, Linux `~/.local/share/jira-approval-local-agent/agent.db`
