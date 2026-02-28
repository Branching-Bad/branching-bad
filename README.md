# Local Approval-First Coding Agent

Local-first, approval-first coding agent with pluggable provider system. Connects to external services (Jira, Sentry, CloudWatch, PostgreSQL) via a unified provider interface, syncs tasks, generates implementation plans requiring human approval, then launches a git branch and executes.

## Features

### Core
- Local repo selection and registration
- AI agent discovery (Claude Code, Codex, Gemini, OpenCode, Cursor) with per-repo profile selection
- Plan generation, user approval (approve/reject/revise), run execution on approved plans
- Git worktree isolation for parallel work
- SQLite persistence, Rust backend (Axum + rusqlite)

### Providers (Pluggable)
- **Jira** — Board sync, task import, assignee filtering
- **Sentry** — Error/issue sync, stack trace viewing, task creation
- **PostgreSQL** — Performance analyzer, slow query detection
- **CloudWatch Logs** — Log investigation pipeline: AI agent analyzes codebase, generates CW Insights queries, fetches logs, performs root cause analysis

### CloudWatch Log Investigator
3-stage flow:
1. **Query Generation** — Agent analyzes the codebase, generates a CloudWatch Insights query, runs it automatically
2. **Results Review** — Error logs, request traces, and the generated query are shown to the user
3. **Analysis** — On user approval, the agent analyzes logs and produces root cause + fix suggestions

Additional features: save queries, run saved queries (agent is skipped), create tasks from investigations.

### Settings
All provider settings pre-fill with current credentials and selected resource (board/project/log group/DB) when opened.

## Setup
```bash
# Rust toolchain required (cargo/rustc):
# https://rustup.rs/
npm install
cd web && npm install && cd ..
```

## Running
```bash
npm run dev
```

- Backend: `http://localhost:4310`
- Frontend: `http://localhost:5173`

## Build & Typecheck
```bash
npm run typecheck
npm run build
npm run check:server   # cargo check
```

## Architecture

```
server-rs/           Rust backend (Axum + rusqlite)
├── src/
│   ├── main.rs          Route definitions + handlers
│   ├── provider/        Pluggable provider system
│   │   ├── jira/        Jira REST API v3
│   │   ├── sentry/      Sentry REST API
│   │   ├── postgres/    PostgreSQL performance analyzer
│   │   └── cloudwatch/  AWS CloudWatch Logs + AI investigator
│   ├── db/              SQLite modules (repos, tasks, plans, runs, providers, investigations)
│   ├── planner.rs       Plan generation via AI agent CLI
│   ├── executor.rs      Git operations, branch/worktree management
│   └── discovery.rs     AI agent binary discovery
web/                 React frontend (React 19, Vite 7, Tailwind CSS v4)
├── src/
│   ├── App.tsx          Main component
│   ├── providers/       Frontend provider registry (mirrors backend)
│   │   ├── jira/
│   │   ├── sentry/
│   │   ├── postgres/
│   │   └── cloudwatch/  Drawer + Investigation modal
│   └── components/      Shared UI (kanban, settings, icons)
```

## Adding a New Provider

### Backend
1. Create `server-rs/src/provider/<name>/`, implement the `Provider` trait
2. Add `pub mod <name>;` and register in `register_all()` in `provider/mod.rs`

### Frontend
1. Create `web/src/providers/<name>/` (DrawerSection + index.ts)
2. Import and call register in `providers/init.ts`

No changes needed in App.tsx, ExtensionsDrawer.tsx, or ProviderSettingsModal.tsx.

## Local DB Location
- macOS: `~/Library/Application Support/jira-approval-local-agent/agent.db`
- Linux: `~/.local/share/jira-approval-local-agent/agent.db`
- Windows: `%APPDATA%\\jira-approval-local-agent\\agent.db`
