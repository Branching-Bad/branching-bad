# Branching Bad

Local-first, approval-first coding agent with a pluggable provider system. Connects to external services via a unified provider interface, syncs tasks, generates implementation plans requiring human approval, then launches a git branch and executes.

## Features

- **Kanban Board** — Visual task management with drag-and-drop
- **Plan Generation** — AI-powered implementation plans from task descriptions
- **Human Approval** — Plans require explicit approval before execution
- **Code Review** — Inline diff review with comments, merge strategies, push & PR creation
- **Chat** — Follow-up messages to running agents
- **Provider System** — Pluggable integrations for external services
- **Agent Profiles** — Configurable AI agent selection per task, repo, or action
- **Git Workflow** — Branch creation, worktrees, merge strategies, push, PR via `gh` CLI

## Providers

| Provider | Description |
|----------|-------------|
| **Jira** | Sync Jira issues as tasks |
| **Sentry** | Import Sentry issues for investigation |
| **PostgreSQL** | Query databases, import schema/data |
| **CloudWatch** | AWS CloudWatch log analysis |
| **SonarQube** | Connect to corporate SonarQube servers to sync issues, or run local Docker-based scans with quality gate/profile management |

## Architecture

Monorepo with two main parts:

- **server-rs/** — Rust backend (Axum + rusqlite). Single-binary HTTP server with SQLite persistence.
- **web/** — React frontend (React 19, Vite 7, Tailwind CSS v4). Two-column layout with kanban board and detail sidebar.

## Prerequisites

- [Rust](https://rustup.rs/) (stable)
- [Node.js](https://nodejs.org/) (v18+)
- [Docker](https://www.docker.com/) (optional, for SonarQube local scanning)

## Getting Started

```bash
# Install dependencies
npm install
cd web && npm install && cd ..

# Development (runs backend + frontend concurrently)
npm run dev
```

Backend: http://localhost:4310 — Frontend: http://localhost:5173 (proxies `/api` to backend)

## Commands

```bash
npm run dev              # Run backend + frontend concurrently
npm run dev:server       # Rust backend only
npm run dev:web          # Vite frontend only
npm run build            # Production build (web + cargo)
npm run typecheck        # Frontend type checking
npm run check:server     # cargo check on backend
```

## Configuration

| Variable | Description | Default |
|----------|-------------|---------|
| `PORT` | Backend port | `4310` |
| `APP_DATA_DIR` | SQLite database directory | OS app data dir |

Database location:
- macOS: `~/Library/Application Support/branching-bad/agent.db`
- Linux: `~/.local/share/branching-bad/agent.db`
- Windows: `%APPDATA%\branching-bad\agent.db`

## Task Lifecycle

```
TODO → PLAN_GENERATING → PLAN_DRAFTED → PLAN_APPROVED → IN_PROGRESS → IN_REVIEW → DONE/FAILED
                                ↓              ↑
                     PLAN_REVISE_REQUESTED ─────┘
```

Optional **auto-approve** skips the manual approval step — plans are approved and execution starts automatically. Tasks can also be `PAUSED_FOR_REAPPROVAL` or `CANCELLED`.
