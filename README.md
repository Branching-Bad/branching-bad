# Local Approval-First Coding Agent

Local-first, approval-first coding agent with pluggable provider system. Connects to external services (Jira, Sentry, CloudWatch, PostgreSQL) via a unified provider interface, syncs tasks, generates implementation plans requiring human approval, then launches a git branch and executes.

## Özellikler

### Core
- Local repo seçimi ve kayıt
- AI agent discovery (Claude Code, Codex, Gemini, OpenCode, Cursor) ve repo bazlı profil seçimi
- Plan üretimi, kullanıcı onayı (approve/reject/revise), onaylı planla run başlatma
- Git worktree isolation ile paralel çalışma
- SQLite persistence, backend Rust (Axum + rusqlite)

### Providers (Pluggable)
- **Jira** — Board sync, task import, assignee filtreleme
- **Sentry** — Error/issue sync, stack trace görüntüleme, task oluşturma
- **PostgreSQL** — Performance analyzer, slow query detection
- **CloudWatch Logs** — Log investigation pipeline: AI agent codebase'i analiz edip CW Insights sorgusu üretir, logları çeker, root cause analizi yapar

### CloudWatch Log Investigator
3 aşamalı akış:
1. **Sorgu Üretimi** — Agent codebase'i analiz eder, CloudWatch Insights sorgusu üretir, otomatik çalıştırır
2. **Sonuç Gösterimi** — Error logları, request trace'ler, üretilen sorgu kullanıcıya gösterilir
3. **Analiz** — Kullanıcı onayıyla agent logları analiz eder, root cause + fix suggestion üretir

Ek özellikler: sorgu kaydetme, kayıtlı sorgu çalıştırma (agent atlanır), investigation'dan task oluşturma.

### Settings
Tüm provider'ların ayarları açıldığında mevcut credentials ve seçili resource (board/project/log group/DB) dolu gelir.

## Kurulum
```bash
# Rust toolchain gerekli (cargo/rustc):
# https://rustup.rs/
npm install
cd web && npm install && cd ..
```

## Çalıştırma
```bash
npm run dev
```

- Backend: `http://localhost:4310`
- Frontend: `http://localhost:5173`

## Build ve typecheck
```bash
npm run typecheck
npm run build
npm run check:server   # cargo check
```

## Mimari

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

## Yeni Provider Ekleme

### Backend
1. `server-rs/src/provider/<name>/` oluştur, `Provider` trait'i implement et
2. `provider/mod.rs`'de `pub mod <name>;` + `register_all()`'a ekle

### Frontend
1. `web/src/providers/<name>/` oluştur (DrawerSection + index.ts)
2. `providers/init.ts`'de import + register

App.tsx, ExtensionsDrawer.tsx, ProviderSettingsModal.tsx değişiklik gerektirmez.

## Local DB konumu
- macOS: `~/Library/Application Support/jira-approval-local-agent/agent.db`
- Linux: `~/.local/share/jira-approval-local-agent/agent.db`
- Windows: `%APPDATA%\\jira-approval-local-agent\\agent.db`
