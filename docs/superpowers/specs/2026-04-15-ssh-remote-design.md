# SSH (Remote) — Design Spec

**Date:** 2026-04-15
**Status:** Draft, pending user review
**Author:** Claude (senior frontend/backend architect role, brainstormed with user)
**Reference project:** `../sshmaster` (Electron-based SSH manager, ~900 lines)

## Motivation

Port the sshmaster feature set into the main app as a first-class page. Users can save SSH connections, connect, operate one or more shells per host, and optionally hand off to their system terminal — all without leaving the app. Same rules as the rest of the codebase: SQLite persistence, cross-platform, local-first, three-column app shell.

## Scope

### v1 (this spec)

- Connection CRUD: name, host, port, username, auth type (password or PEM key path + optional passphrase).
- Multiple simultaneous sessions, including multiple sessions to the same host.
- Embedded xterm.js terminal, tabbed per session within the selected connection.
- "Launch System Terminal" per session (Terminal.app / Windows Terminal / gnome-terminal).
- `known_hosts` management with trust-on-first-use. Mismatched fingerprint prompts for re-approval.
- Connection history (last-N attempts with timestamp, status).
- PEM files are referenced by absolute path — the app never reads the key into SQLite, never copies the file.
- Active session indicator on the SSH rail nav item (muted pulsing dot) and on each connection card in the left list (badge + pulsing dot).
- Session persistence across UI navigation: leaving `#ssh` does not disconnect; returning restores the same tabs.

### Out of scope (v2+)

- Groups and client-side search/filter (v1 ships with a plain list).
- Port forwarding (local `-L` / remote `-R`).
- Jump host / bastion (one level).
- JSON import/export.
- Auto-migration from `~/.sshmaster/connections.json`.
- Agent forwarding (`-A`), X11 forwarding, sftp browser.

## Layout (Task Analyst pattern)

```
┌─────────────────┬───────────────────────────────────────┐
│  SSH            │ prod-api                              │
│  [🔍 Search ]   │ deploy@api.foo.com:22                 │
│  [+ New]        │ [+ New Session] [Edit] [Delete]       │
│                 │───────────────────────────────────────│
│ 🟢 prod-api  2● │                                       │
│   deploy@api.   │  [Tab: a1b2c3] [Tab: d4e5f6] [+]     │
│                 │                                       │
│   staging       │  ┌─────────────────────────────────┐ │
│   admin@10.     │  │                                 │ │
│                 │  │  xterm (fills remaining height) │ │
│ 🟢 dev-box   1● │  │                                 │ │
│   melih@dev.    │  └─────────────────────────────────┘ │
│                 │  [System Terminal]   [Disconnect]    │
└─────────────────┴───────────────────────────────────────┘
```

- **Left pane (260px):** connection list + search input + "New" button.
  - Each card: alias (bold), `user@host:port` (muted), right-side badge if active sessions (`2●`).
  - Active cards have a muted pulsing dot next to the name (1.5s ease loop, color: `text-status-success` at 40% opacity peak).
  - Click a card to select it; the right pane updates.
  - Selected card: `bg-brand-tint` with inset brand glow (same treatment as rail active state).
- **Right pane (flex-1):** selected connection header + tab bar + embedded terminal + footer actions.
  - Header: connection name, full `user@host:port`, right-aligned actions (`New Session`, `Edit`, `Delete`).
  - Tab bar: one tab per PTY session. Click to switch. `x` on each tab closes that PTY (keeps SSH session alive if other tabs reference it; last tab close → disconnect SSH client). `+` button starts a new PTY on the selected connection.
  - Terminal: xterm instance fills remaining vertical space, fit-to-container via `xterm-addon-fit`. One xterm instance per PTY; switching tabs swaps DOM attachment.
  - Footer: `System Terminal` button (spawns native terminal via `ssh …`), `Disconnect` button (closes the selected PTY). Always visible when a tab is active.
- **Empty states:**
  - No connection selected: "Select a connection or create a new one." centered.
  - Connection selected, no sessions: "No sessions yet. Click + New Session to start one."

### New / Edit Connection modal

A `CreateTaskModal`-style modal opened from the left pane's `+ New` button or the right pane's `Edit` button. Fields:

| Field         | Type                              |
|---------------|-----------------------------------|
| Alias         | text (required, unique)           |
| Host          | text (required)                   |
| Port          | number, default 22                |
| Username      | text (required)                   |
| Auth type     | radio: `password` / `key`         |
| Password      | password input (shown if `password`) |
| Key path      | `FolderPicker`-style file picker (shown if `key`) |
| Passphrase    | password input (optional, shown if `key`) |

Validation: alias non-empty and unique, host non-empty, port in `[1, 65535]`, username non-empty, `password` or `keyPath` set based on auth type. Save: POST new, PATCH existing. Modal closes on success.

### Host key prompt

When connecting:
- **First connection to host:port** (no known key): modal prompt "Unknown host key. Fingerprint: SHA256:abc… — Approve?" [Approve] [Cancel]
- **Fingerprint mismatch**: modal prompt with stronger red styling, showing expected + actual fingerprints. [Approve (replace)] [Cancel]

Approval stores the fingerprint in `ssh_host_keys` and continues the connection. Cancel rejects the connection with error code `HOST_KEY_MISMATCH`, shown as toast.

## Routing

Add to `useHashRoute.ts`:
- `#ssh` → `SshView` component.

Update `SideRail.tsx`:
- New group: `REMOTE` (between CONFIGURE and footer), containing a single item:
  - `🖥 SSH` (icon: a small terminal/monitor glyph).
- When any SSH session is active (backend reports >0 live sessions): show a muted pulsing dot next to the "SSH" label in the rail. Implementation: a `pulsing` prop on `SideRail`'s nav item, driven by a top-level count from `App.tsx`.

## Backend Architecture

### New files

```
server-ts/src/ssh/
  index.ts                ← exports registerSshRoutes, sshManager singleton
  sshManager.ts           ← SSH client lifecycle (ssh2 Client), sessions map
  ptyManager.ts           ← shell() stream wrapping, attaches to SSH client
  hostKeyStore.ts         ← fingerprint verify using ssh_host_keys table
  terminalLauncher.ts     ← spawn native terminal with ssh cmd
  types.ts                ← SshConnection, SshSession, SshHostKey interfaces
server-ts/src/routes/ssh.ts    ← HTTP routes (CRUD + connect + disconnect + history + known_hosts)
server-ts/src/db/ssh.ts        ← DB methods via `declare module` pattern
server-ts/migrations/V14__add_ssh_tables.sql
```

### Responsibilities

- `sshManager.ts`: `connect(conn, onHostKey) → sessionId`, `disconnect(sessionId)`, `getClient(sessionId)`, `listSessions() → {sessionId, connectionId, connectedAt}[]`. Uses `ssh2.Client`. Error-code wrapping mirrors sshmaster's `wrapError` (AUTH_FAILED / HOST_UNREACHABLE / TIMEOUT / HOST_KEY_MISMATCH / KEY_READ_ERROR / UNKNOWN).
- `ptyManager.ts`: `openShell(sessionId, {cols, rows}) → ptyId`, `write(ptyId, data)`, `resize(ptyId, cols, rows)`, `close(ptyId)`. Each PTY is a `ClientChannel` from `client.shell(...)`. Data events bridged to WebSocket broadcast per-pty-subscriber.
- `hostKeyStore.ts`: `checkHostKey(host, port, fingerprint) → 'unknown' | 'match' | 'mismatch'`, `approveHostKey(host, port, fingerprint)`, `listKnownHosts()`, `deleteKnownHost(host, port)`.
- `terminalLauncher.ts`: per-platform command builder:
  - macOS: `open -a Terminal "$(command)"` with a wrapper shell script, OR `osascript -e 'tell app "Terminal" to do script "..."'`.
  - Windows: `wt.exe new-tab ssh ...` with `cmd /c`.
  - Linux: try `gnome-terminal -- ssh ...`, fallback `xterm -e ssh ...`, fallback `x-terminal-emulator -e`.
  - Cross-platform: build args as `string[]`, `spawnSync(bin, args)`, `shell: process.platform === 'win32'` as needed. No string shell-escaping.
- `routes/ssh.ts`: standard REST + a `POST /api/ssh/connections/:id/connect` that returns `{sessionId}` after host-key dance + auth, and a `DELETE /api/ssh/sessions/:sessionId` for disconnect. See endpoint list below.

### Host-key prompt flow (HTTP)

Connecting requires user interaction for unknown/mismatched keys. Two-step flow to avoid long-polling:

1. Client: `POST /api/ssh/connections/:id/connect`.
2. Server: begins ssh2 connect, captures host key in `hostVerifier`. If `checkHostKey` returns `unknown` or `mismatch`, abort the ssh client, return `409 HOST_KEY_PROMPT { host, port, fingerprint, kind: 'unknown' | 'mismatch', expected?: string }`. **The connection is NOT established.**
3. Client: shows modal. On approve: `POST /api/ssh/known-hosts { host, port, fingerprint }` then retry step 1. On cancel: toast error.
4. On retry, `checkHostKey` returns `match` → normal auth path → returns `{sessionId}`.

This is stateless, no queue of pending prompts, simpler than sshmaster's IPC pattern. Cost: a wasted TCP round-trip on first connect. Acceptable.

### WebSocket protocol

New message types (current `websocket.ts` dispatches events by `type`):

Client → server:
```json
{ "type": "ssh:pty.subscribe", "ptyId": "..." }
{ "type": "ssh:pty.write", "ptyId": "...", "data": "..." }
{ "type": "ssh:pty.resize", "ptyId": "...", "cols": 80, "rows": 24 }
```

Server → client:
```json
{ "type": "ssh:pty.data", "ptyId": "...", "data": "..." }
{ "type": "ssh:pty.close", "ptyId": "..." }
{ "type": "ssh:session.closed", "sessionId": "..." }
```

`ssh:pty.data` is binary-safe by encoding as UTF-8 string; the underlying ssh2 `ClientChannel` emits Buffer, we send the UTF-8 decoding (same as xterm.js expects). This matches sshmaster's `session:write` / `pty:data` pattern.

### HTTP routes

| Method | Path                                      | Purpose                                |
|--------|-------------------------------------------|----------------------------------------|
| GET    | `/api/ssh/connections`                    | List all connections                   |
| POST   | `/api/ssh/connections`                    | Create                                 |
| PATCH  | `/api/ssh/connections/:id`                | Update                                 |
| DELETE | `/api/ssh/connections/:id`                | Delete                                 |
| POST   | `/api/ssh/connections/:id/connect`        | Open SSH client → `{sessionId}` (or 409 HOST_KEY_PROMPT) |
| DELETE | `/api/ssh/sessions/:sessionId`            | Disconnect an SSH client               |
| GET    | `/api/ssh/sessions`                       | List live sessions `{sessionId, connectionId, connectedAt}` |
| POST   | `/api/ssh/sessions/:sessionId/pty`        | Open a PTY on a session → `{ptyId}`   |
| DELETE | `/api/ssh/ptys/:ptyId`                    | Close a PTY                            |
| POST   | `/api/ssh/sessions/:sessionId/launch-terminal` | Launch system terminal (server spawns) |
| GET    | `/api/ssh/known-hosts`                    | List known hosts                       |
| POST   | `/api/ssh/known-hosts`                    | Approve/add host key                   |
| DELETE | `/api/ssh/known-hosts/:host/:port`        | Remove known host entry                |
| GET    | `/api/ssh/history?limit=50`               | Recent connection attempts             |

### Data model (SQLite)

New migration file `server-ts/migrations/V14__add_ssh_tables.sql`:

```sql
CREATE TABLE IF NOT EXISTS ssh_connections (
  id TEXT PRIMARY KEY,
  alias TEXT NOT NULL UNIQUE,
  host TEXT NOT NULL,
  port INTEGER NOT NULL DEFAULT 22,
  username TEXT NOT NULL,
  auth_type TEXT NOT NULL CHECK (auth_type IN ('password', 'key')),
  key_path TEXT,              -- absolute filesystem path, nullable for password auth
  password_cipher TEXT,       -- encrypted password blob (optional, see Security)
  has_passphrase INTEGER NOT NULL DEFAULT 0,
  passphrase_cipher TEXT,     -- encrypted passphrase blob (optional)
  last_connected_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS ssh_host_keys (
  host TEXT NOT NULL,
  port INTEGER NOT NULL,
  fingerprint TEXT NOT NULL,   -- SHA256:... format
  approved_at TEXT NOT NULL,
  PRIMARY KEY (host, port)
);

CREATE TABLE IF NOT EXISTS ssh_history (
  id TEXT PRIMARY KEY,
  connection_id TEXT NOT NULL,
  attempted_at TEXT NOT NULL,
  status TEXT NOT NULL,        -- 'connected' | 'failed'
  error_code TEXT,
  duration_sec INTEGER
);

CREATE INDEX IF NOT EXISTS idx_ssh_history_conn ON ssh_history(connection_id, attempted_at DESC);
```

### Security

- **PEM files never stored.** We store `key_path` only. On connect, `fs.readFileSync(key_path)` in-memory, passed to ssh2 and discarded. If file is unreadable, return `KEY_READ_ERROR`.
- **Passwords**: encrypted at rest using the system keychain via Electron `safeStorage`? We're not Electron. Alternative: Node's `crypto.createCipheriv('aes-256-gcm', …)` with a key derived from a per-install random value stored outside SQLite (e.g. `<APP_DATA_DIR>/.ssh_key`). Simpler v1: store passwords as plain base64 in the DB, mark field `password_cipher` for future migration. **v1 ships with base64 storage but the column is named `_cipher` so we can migrate without schema change.** Document this clearly in code comments.
- **Known hosts**: fingerprint comparison rejects silently on mismatch until user approves. `ssh_host_keys` table keyed by `(host, port)`.
- **Launched system terminals** receive the ssh command, not the password. Password auth with system terminals is not supported (falls back to key-based or interactive prompt in the terminal).

## Frontend Architecture

### New files

```
web/src/views/SshView.tsx                        ← root view: 2-column layout
web/src/components/ssh/
  ConnectionList.tsx                              ← left pane list + search + new button
  ConnectionCard.tsx                              ← single row in list
  ConnectionDetail.tsx                            ← right pane for selected connection
  SessionTabBar.tsx                               ← tabs above xterm
  Terminal.tsx                                    ← wraps xterm + addon-fit + WS hookup
  ConnectionFormModal.tsx                         ← new/edit
  HostKeyPromptModal.tsx                          ← approval dialog
web/src/hooks/
  useSshConnections.ts                            ← connection CRUD + list state
  useSshSessions.ts                               ← open/close sessions, subscribes to WS 'ssh:session.closed'
  useSshPty.ts                                    ← per-PTY lifecycle (open, write, data, resize, close)
web/src/types.ts                                  ← add SshConnection, SshSession, SshPtyRef types
```

### State management

All SSH state is top-level in `App.tsx` (same pattern as existing hooks). Add:

```typescript
const sshConnections = useSshConnections({ setError, setInfo });
const sshSessions = useSshSessions({ streamRef, setError });
```

Passed down to `SshView` as props. `sshSessions.liveSessionCount` drives the pulsing dot on the rail's SSH nav item.

### Terminal rendering

- `xterm` and `xterm-addon-fit` installed in `web/package.json`.
- `Terminal` component creates a `new Terminal()` on mount, attaches `FitAddon`, wires `onData` → WebSocket `ssh:pty.write`, subscribes to `ssh:pty.data` events.
- One `Terminal` instance per PTY. Switching tabs toggles `className="hidden"` on non-active ones, keeping the xterm DOM intact to preserve scrollback.
- On resize (`ResizeObserver` on the container), call `fit.fit()` and send `ssh:pty.resize` with new cols/rows.

### Active-session indicator

- Muted pulsing dot: a CSS `@keyframes ssh-pulse` (1.5s, scale 1→1.25 with opacity 0.4→0.9) on a 6px dot.
- On `ConnectionCard`: shown to the right of the alias when the connection has ≥1 live session.
- On `SideRail` SSH nav item: shown when `liveSessionCount > 0`. Requires extending `SideRail` to accept a new `sshLiveCount` prop (or generalizing to a per-item "indicator" prop).

### Session persistence across navigation

The SSH sessions live on the server. When the user navigates away from `#ssh`, we keep the WebSocket subscriptions open (don't unsubscribe). When the user navigates back, the hook `useSshSessions` already has the full state. The `Terminal` components re-mount but immediately re-subscribe to existing ptyIds — scrollback is lost (xterm DOM was unmounted), but the SSH session and PTY stay alive on the server. If we want to preserve scrollback, we'd need a server-side scrollback buffer — **out of scope for v1**. Document this as a known limitation.

## Routing & nav changes

`web/src/hooks/useHashRoute.ts`:

```typescript
export const ROUTES = [
  "board", "analyst", "workflow",
  "extensions", "agents", "rules", "memories", "glossary", "repos", "data",
  "ssh",   // <-- new
] as const;
```

`web/src/components/SideRail.tsx`: add a new nav group between `CONFIGURE` and the footer:

```typescript
const remoteItems: NavItem[] = [
  { route: "ssh", label: "SSH", icon: IconSshRail, indicator: sshLiveCount > 0 ? "pulse" : undefined },
];
```

Render a third `NavGroup` titled `REMOTE`. Icon: a small monitor/terminal glyph.

## Cross-platform

- `spawnSync(bin, argsArray)` for all launches. No string shell escaping.
- `shell: process.platform === 'win32'` for `.cmd` shim resolution if needed.
- Terminal launcher: strict per-OS branching with fallbacks; if no terminal is found on Linux, return `NO_TERMINAL` error displayed as toast.
- PEM paths: absolute paths only. No `~/` expansion — we use `os.homedir()` replacement if input starts with `~/`. Windows backslashes handled by Node fs normally.
- Config paths: no new files; all storage in the existing SQLite DB at the canonical `APP_DATA_DIR` location.

## Success Criteria

- Rail shows `REMOTE > SSH`. Clicking routes to `#ssh`.
- `SshView` renders left list + right detail in Task Analyst layout.
- Creating a connection opens the form modal, saving persists to SQLite, the new entry appears in the list.
- Selecting a connection and clicking "New Session" opens an SSH client, opens a PTY, and renders an xterm. Typing in xterm reaches the remote host; remote output renders.
- Multiple PTYs per connection work: tabs switch instantly, no stream cross-talk.
- Multiple connections open simultaneously: each maintains its own xterm tab state.
- Closing the last tab on a connection disconnects the SSH client.
- Disconnecting triggers the rail indicator to disappear (animation stops when `liveSessionCount` returns to 0).
- Launching system terminal spawns the native terminal emulator with `ssh user@host -p port -i keyPath` (or omits `-i` for password auth).
- Host key TOFU: connecting to a new host prompts; approving saves the fingerprint; subsequent connects silently proceed; forged fingerprint (simulated by editing `ssh_host_keys`) triggers the mismatch modal.
- Leaving `#ssh` and returning re-displays the tabs for all still-live sessions. (Scrollback lost — documented limitation.)
- `npm run build` passes. `npm run check:server` passes. ESLint on `web/` introduces zero new errors.
- Cross-platform: tested on macOS (dev). Windows/Linux guarded by spawn patterns and per-OS branches, no platform-locked shell calls.

## Out of Scope (explicitly, v2+)

- Groups and search (the list may grow; we'll add search when >20 typical).
- Port forwarding panel in the form and active status on the connection detail.
- Jump host picker and bastion chaining.
- JSON import/export dialog.
- Migration from `~/.sshmaster/connections.json` (one-time opt-in import).
- Scrollback preservation across navigation.
- SFTP / file browser.
- Agent / X11 forwarding.
- Password credential encryption using OS keychain (v1 uses base64 with `_cipher`-suffixed columns for future migration).

## Open Questions

None at spec-writing time. Implementation plan will surface concrete tasks.
