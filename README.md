# Jira Approval-First Local Agent (MVP)

Local-first uygulama: Jira task'larını kendi kullanıcı tokenınla çeker, plan üretir, kullanıcı onayı alır ve yalnızca onay sonrası kontrollü run başlatır.

## Özellikler
- Local repo seçimi ve kayıt.
- Jira bağlantısı (`base URL`, `email`, `API token`).
- Board seçimi ve repo-board eşleştirme.
- `assignee = currentUser()` task sync.
- Local agent/model discovery (Claude Code, Codex, Gemini, OpenCode, Cursor) ve repo bazlı profil seçimi.
- Plan üretimi (`drafted`), kullanıcı aksiyonları (`approve`, `reject`, `revise`).
- Onaylı planla run başlatma ve `codex/<TASK_KEY>-<suffix>` branch açma.
- SQLite persistence (token MVP gereği plaintext saklanır).
- Backend Rust (`Axum + rusqlite`) olarak çalışır.

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
```

## Local DB konumu
- macOS: `~/Library/Application Support/jira-approval-local-agent/agent.db`
- Linux: `~/.local/share/jira-approval-local-agent/agent.db`
- Windows: `%APPDATA%\\jira-approval-local-agent\\agent.db`
