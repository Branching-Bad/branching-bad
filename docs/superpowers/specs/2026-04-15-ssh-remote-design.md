# SSH (Remote) — Design Spec

**Date:** 2026-04-15
**Status:** Draft, pending user review
**Author:** Claude (senior frontend/backend architect role, brainstormed with user)
**Reference project:** `../sshmaster` (Electron-based SSH manager, ~900 lines)

## Motivation

Port the sshmaster feature set into the main app as a first-class page. Users can save SSH connections, connect, operate one or more shells per host, and optionally hand off to their system terminal — all without leaving the app. Same rules as the rest of the codebase: SQLite persistence, cross-platform, local-first, three-column app shell.

## Scope

All of the following ship in a single release. Cross-platform (macOS, Linux, Windows) from day one.

- Connection CRUD: alias, host, port, username, auth type (password or PEM key path + optional passphrase), optional jump host, optional port forwards list.
- **Groups**: connections belong to zero or one group. UI collapses/expands groups in the left pane.
- **Search** input in the left pane filters connections by alias / host / username (client-side, plain substring).
- Multiple simultaneous SSH sessions, including multiple sessions to the same host.
- Embedded xterm.js terminal, tabbed per PTY within the selected connection.
- **Scrollback preservation across UI navigation**: the server keeps a per-PTY ring buffer (capped at 256 KiB) of recent output. On (re)subscribe, the server replays the buffer so the xterm shows the same recent history.
- "Launch System Terminal" per connection (Terminal.app / Windows Terminal / gnome-terminal / xterm fallback).
- **Port forwarding**: per connection, user defines `local` (`-L`) or `remote` (`-R`) forwards. Activated on connect, deactivated on disconnect. Errors surface as toasts.
- **Jump host (one level of bastion)**: connection may reference another connection as a bastion; the app dials the bastion first, opens a TCP-forwarded stream, and dials the target through it.
- `known_hosts` management with trust-on-first-use. Mismatched fingerprint prompts for re-approval.
- Connection history: every attempt logged with timestamp and status (connected / failed), retained last 200 rows.
- **JSON import/export**: export produces a single file with connections, groups, known hosts, history. Import accepts the same format with a strategy switch (skip / update).
- **One-time migration** from `~/.sshmaster/connections.json` (if present) on first SSH view mount. User gets a one-shot banner "Import 12 connections from SSHMaster?" with [Import] / [Dismiss]. Dismissal is remembered so the banner never reappears.
- PEM files are referenced by absolute path — the app never reads the key into SQLite, never copies the file.
- **Passwords and passphrases are encrypted at rest** using AES-256-GCM with a per-install master key stored at `<APP_DATA_DIR>/.ssh_master_key` with `0600` permissions (Unix) / ACL-restricted (Windows via `fs.chmod` no-op + file attribute best-effort).
- Active session indicator on the SSH rail nav item (muted pulsing dot) and on each connection card in the left list.
- Session persistence across UI navigation: leaving `#ssh` does not disconnect; returning restores the same tabs with replayed scrollback.

### Explicitly out of scope (future)

- Agent forwarding (`-A`), X11 forwarding, sftp file browser.
- Multi-level jump hosts (more than one bastion in the chain).
- OS keychain integration (our per-install master key is strictly on-disk with restricted perms).
- GUI terminal theming / font customization (uses xterm defaults).

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

A `CreateTaskModal`-style modal opened from the left pane's `+ New` button or the right pane's `Edit` button. The modal has three sections:

**Section 1 — Identity**

| Field         | Type                              |
|---------------|-----------------------------------|
| Alias         | text (required, unique)           |
| Group         | select (existing groups + "— None —" + "+ New group…") |
| Host          | text (required)                   |
| Port          | number, default 22                |
| Username      | text (required)                   |
| Auth type     | radio: `password` / `key`         |
| Password      | password input (shown if `password`) |
| Key path      | file picker via `FolderPicker`-style component (shown if `key`) |
| Passphrase    | password input (optional, shown if `key`) |

**Section 2 — Jump host (optional, collapsible)**

| Field         | Type                              |
|---------------|-----------------------------------|
| Via           | select of existing connections + "— None —" |

Only one level of chaining is permitted — if connection A uses B as a jump, B itself must not have a jump host. Validation rejects circular references.

**Section 3 — Port forwards (optional, expandable list)**

A dynamic list where each row has:

| Field         | Type                              |
|---------------|-----------------------------------|
| Type          | select: `local` (`-L`) / `remote` (`-R`) |
| Bind address  | text, default `127.0.0.1`         |
| Bind port     | number `[1, 65535]`               |
| Remote host   | text (required)                   |
| Remote port   | number `[1, 65535]`               |

Each row has a trash button to remove it. Below the list: `+ Add Forward` button.

Validation: alias non-empty and unique, host non-empty, port `[1, 65535]`, username non-empty, `password` or `keyPath` set based on auth type, jump host (if set) points to a connection without its own jump host, each forward row complete. Save: POST new, PATCH existing. Modal closes on success.

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
  index.ts                ← exports registerSshRoutes, manager singletons
  sshManager.ts           ← SSH client lifecycle (ssh2 Client + jump chaining), sessions map
  ptyManager.ts           ← shell() stream wrapping + per-PTY scrollback ring buffer
  forwardManager.ts       ← activate/deactivate port forwards for a session
  hostKeyStore.ts         ← fingerprint verify using ssh_host_keys table
  terminalLauncher.ts     ← spawn native terminal with ssh cmd (per-OS)
  crypto.ts               ← AES-256-GCM helper, master-key file management
  importExport.ts         ← serialize / deserialize connections+groups+knownHosts+history
  migration.ts            ← one-shot import from ~/.sshmaster/connections.json
  types.ts                ← SshConnection, SshSession, SshHostKey, SshForward, SshGroup interfaces
server-ts/src/routes/ssh.ts    ← HTTP routes (CRUD + connect + disconnect + history + known_hosts + groups + forwards + import/export + migration)
server-ts/src/db/ssh.ts        ← DB methods via `declare module` pattern
server-ts/migrations/V14__add_ssh_tables.sql
```

### Responsibilities

- `sshManager.ts`: `connect(conn, onHostKey) → sessionId`, `disconnect(sessionId)`, `getClient(sessionId)`, `listSessions() → {sessionId, connectionId, connectedAt}[]`. Uses `ssh2.Client`. Handles jump-host chaining: if `conn.jumpHostId` set, first establish the bastion client, then `bastionClient.forwardOut('127.0.0.1', 0, target.host, target.port)` to get a stream, then ssh2-connect the target using `opts.sock = stream`. Error-code wrapping mirrors sshmaster's `wrapError` (AUTH_FAILED / HOST_UNREACHABLE / TIMEOUT / HOST_KEY_MISMATCH / KEY_READ_ERROR / JUMP_HOST_FAILED / UNKNOWN).
- `ptyManager.ts`: `openShell(sessionId, {cols, rows}) → ptyId`, `write(ptyId, data)`, `resize(ptyId, cols, rows)`, `close(ptyId)`, `subscribe(ptyId, onData, onClose) → unsubscribe`, `getScrollback(ptyId) → string`. Each PTY is a `ClientChannel` from `client.shell(...)`. Data events fan out to subscribers and also append to an in-memory ring buffer (256 KiB cap, older bytes dropped). When a new subscriber attaches, it receives the full buffer first, then live data.
- `forwardManager.ts`: `activate(sessionId, forward) → void`, `deactivate(sessionId, forwardId) → void`, `deactivateAll(sessionId) → void`, `status(sessionId) → {forwardId, state: 'active' | 'error', message?}[]`. Uses `client.forwardIn(...)` for remote and `net.createServer()` wrapping `client.forwardOut(...)` for local.
- `hostKeyStore.ts`: `checkHostKey(host, port, fingerprint) → 'unknown' | 'match' | 'mismatch'`, `approveHostKey(host, port, fingerprint)`, `listKnownHosts()`, `deleteKnownHost(host, port)`.
- `terminalLauncher.ts`: per-platform command builder:
  - macOS: `osascript -e 'tell app "Terminal" to do script "ssh user@host -p port -i keyPath"' -e 'activate'`.
  - Windows: `wt.exe -w 0 nt ssh user@host -p port -i keyPath` (Windows Terminal). Fallback `cmd /k ssh ...` via `spawnSync('cmd', ['/c', 'start', 'cmd', '/k', 'ssh', ...args])`.
  - Linux: try `gnome-terminal -- ssh ...`, then `konsole -e ssh ...`, then `x-terminal-emulator -e ssh ...`, then `xterm -e ssh ...`. Return `NO_TERMINAL` if none resolves via `which` / `spawnSync`.
  - Cross-platform: build args as `string[]`, `spawnSync(bin, args)`, `shell: process.platform === 'win32'` only where necessary (`.cmd` shims). No string shell escaping. Paths with spaces handled by array-args.
- `crypto.ts`: `getMasterKey() → Buffer` loads or creates `<APP_DATA_DIR>/.ssh_master_key` (32 random bytes, `0600` on Unix). `encrypt(plaintext: string) → string` returns `base64(iv | ciphertext | tag)`. `decrypt(blob: string) → string` reverses. On master-key file loss, decrypt returns `null` and callers treat the field as "password missing; user must re-enter".
- `importExport.ts`: `serialize() → ImportExportBlob` emits JSON `{ version: 1, connections, groups, knownHosts, history }` with encrypted secrets **re-encrypted as empty** (i.e. exports strip passwords/passphrases; key paths included as-is). `deserialize(blob, strategy)` inserts with `skip` or `update`. Returns a report `{ created, updated, skipped }`.
- `migration.ts`: `detectSshmaster() → string | null` returns path to `~/.sshmaster/connections.json` if readable, else null. `importSshmaster(path) → ImportReport` parses sshmaster format, maps fields, writes via existing DB methods.
- `routes/ssh.ts`: standard REST + `POST /api/ssh/connections/:id/connect` returning `{sessionId}` after host-key dance + auth, `DELETE /api/ssh/sessions/:sessionId` for disconnect, `POST /api/ssh/migrations/sshmaster` to trigger import. See endpoint list below.

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

| Method | Path                                            | Purpose                                |
|--------|-------------------------------------------------|----------------------------------------|
| GET    | `/api/ssh/connections`                          | List all connections (secrets masked)  |
| POST   | `/api/ssh/connections`                          | Create                                 |
| PATCH  | `/api/ssh/connections/:id`                      | Update                                 |
| DELETE | `/api/ssh/connections/:id`                      | Delete                                 |
| GET    | `/api/ssh/groups`                               | List groups                            |
| POST   | `/api/ssh/groups`                               | Create group                           |
| PATCH  | `/api/ssh/groups/:id`                           | Rename group                           |
| DELETE | `/api/ssh/groups/:id`                           | Delete group (connections' group set to null) |
| POST   | `/api/ssh/connections/:id/connect`              | Open SSH client → `{sessionId}` (or 409 HOST_KEY_PROMPT) |
| DELETE | `/api/ssh/sessions/:sessionId`                  | Disconnect an SSH client               |
| GET    | `/api/ssh/sessions`                             | List live sessions                     |
| POST   | `/api/ssh/sessions/:sessionId/pty`              | Open a PTY → `{ptyId}`                |
| DELETE | `/api/ssh/ptys/:ptyId`                          | Close a PTY                            |
| GET    | `/api/ssh/sessions/:sessionId/forwards`         | Forward statuses for this session      |
| POST   | `/api/ssh/connections/:id/launch-terminal`      | Launch system terminal (server spawns) |
| GET    | `/api/ssh/known-hosts`                          | List known hosts                       |
| POST   | `/api/ssh/known-hosts`                          | Approve/add host key                   |
| DELETE | `/api/ssh/known-hosts/:host/:port`              | Remove known host entry                |
| GET    | `/api/ssh/history?limit=50`                     | Recent connection attempts             |
| GET    | `/api/ssh/export`                               | JSON blob download (strips secrets)    |
| POST   | `/api/ssh/import`                               | Accept a JSON blob + `strategy` query  |
| GET    | `/api/ssh/migration/sshmaster`                  | Detect `~/.sshmaster/connections.json` |
| POST   | `/api/ssh/migration/sshmaster`                  | Import from detected sshmaster file    |
| POST   | `/api/ssh/migration/sshmaster/dismiss`          | Mark banner dismissed (stored in DB KV)|

### Data model (SQLite)

New migration file `server-ts/migrations/V14__add_ssh_tables.sql`:

```sql
CREATE TABLE IF NOT EXISTS ssh_groups (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS ssh_connections (
  id TEXT PRIMARY KEY,
  alias TEXT NOT NULL UNIQUE,
  group_id TEXT REFERENCES ssh_groups(id) ON DELETE SET NULL,
  host TEXT NOT NULL,
  port INTEGER NOT NULL DEFAULT 22,
  username TEXT NOT NULL,
  auth_type TEXT NOT NULL CHECK (auth_type IN ('password', 'key')),
  key_path TEXT,
  password_cipher TEXT,           -- AES-256-GCM encrypted blob (base64)
  has_passphrase INTEGER NOT NULL DEFAULT 0,
  passphrase_cipher TEXT,
  jump_host_id TEXT REFERENCES ssh_connections(id) ON DELETE SET NULL,
  last_connected_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS ssh_forwards (
  id TEXT PRIMARY KEY,
  connection_id TEXT NOT NULL REFERENCES ssh_connections(id) ON DELETE CASCADE,
  forward_type TEXT NOT NULL CHECK (forward_type IN ('local', 'remote')),
  bind_address TEXT NOT NULL DEFAULT '127.0.0.1',
  bind_port INTEGER NOT NULL,
  remote_host TEXT NOT NULL,
  remote_port INTEGER NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_ssh_forwards_conn ON ssh_forwards(connection_id);

CREATE TABLE IF NOT EXISTS ssh_host_keys (
  host TEXT NOT NULL,
  port INTEGER NOT NULL,
  fingerprint TEXT NOT NULL,
  approved_at TEXT NOT NULL,
  PRIMARY KEY (host, port)
);

CREATE TABLE IF NOT EXISTS ssh_history (
  id TEXT PRIMARY KEY,
  connection_id TEXT NOT NULL,
  attempted_at TEXT NOT NULL,
  status TEXT NOT NULL,            -- 'connected' | 'failed'
  error_code TEXT,
  duration_sec INTEGER
);

CREATE INDEX IF NOT EXISTS idx_ssh_history_conn ON ssh_history(connection_id, attempted_at DESC);

CREATE TABLE IF NOT EXISTS ssh_kv (
  key TEXT PRIMARY KEY,            -- arbitrary internal flags, e.g. 'sshmaster_migration_dismissed'
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
```

Jump-host validation is enforced at the route layer (not DB): we reject `jump_host_id` pointing to a connection whose own `jump_host_id` is non-null.

### Security

- **PEM files never stored.** We store `key_path` only. On connect, `fs.readFileSync(key_path)` in-memory, passed to ssh2 and discarded. If file is unreadable, return `KEY_READ_ERROR`.
- **Passwords and passphrases encrypted at rest** with AES-256-GCM. Master key: 32 random bytes generated on first use and stored at `<APP_DATA_DIR>/.ssh_master_key`.
  - Unix: `fs.chmodSync(path, 0o600)` after write. `fs.openSync(path, 'wx', 0o600)` on create to avoid race.
  - Windows: `chmod` is a no-op; we rely on the default NTFS ACL inheritance from `APP_DATA_DIR` which is user-scoped by default.
  - On decrypt failure (tag mismatch, missing master key): return `null`, route responds with a field-level warning so the UI prompts re-entry. Connection is still listed; auth attempts fail with `AUTH_FAILED` until corrected.
- **Secrets never sent to the client.** GET endpoints mask `password_cipher` / `passphrase_cipher` as `has_password: boolean` only. POST/PATCH accept plaintext in the body; the server encrypts before persistence.
- **Known hosts**: fingerprint comparison rejects silently on mismatch until user approves. `ssh_host_keys` table keyed by `(host, port)`.
- **Launched system terminals** receive the ssh command (no password). Password-auth connections cannot be launched as system terminals — the Launch button is disabled with a tooltip ("Password auth: use the embedded terminal or configure key-based auth"). Key-auth connections pass `-i keyPath`.
- **Exports strip secrets.** `/api/ssh/export` returns connections with `password_cipher = null`, `passphrase_cipher = null`, `has_password = false`. Users re-enter secrets after import. This is intentional: export files are portable, passwords stay per-install.

## Frontend Architecture

### New files

```
web/src/views/SshView.tsx                         ← root view: 2-column layout + migration banner
web/src/components/ssh/
  ConnectionList.tsx                              ← left pane: search + group sections + new button
  ConnectionCard.tsx                              ← single row (with pulsing dot + badge)
  ConnectionDetail.tsx                            ← right pane for selected connection
  SessionTabBar.tsx                               ← tabs above xterm
  Terminal.tsx                                    ← wraps xterm + addon-fit + WS hookup + scrollback replay
  ConnectionFormModal.tsx                         ← new/edit (3 sections incl. jump host + forwards)
  ForwardsEditor.tsx                              ← dynamic forward list inside ConnectionFormModal
  HostKeyPromptModal.tsx                          ← approval dialog
  KnownHostsPanel.tsx                             ← list / delete known hosts (opened from right pane "..." menu)
  ImportExportMenu.tsx                            ← action menu for left-pane "+ New" button dropdown
  MigrationBanner.tsx                             ← one-shot prompt for ~/.sshmaster import
web/src/hooks/
  useSshConnections.ts                            ← connection CRUD + groups + list state
  useSshSessions.ts                               ← open/close sessions, subscribes to WS 'ssh:session.closed', forward statuses
  useSshPty.ts                                    ← per-PTY lifecycle (open, write, data, resize, close, scrollback request)
  useSshMigration.ts                              ← detect + trigger + dismiss sshmaster import
web/src/types.ts                                  ← SshConnection, SshSession, SshPtyRef, SshForward, SshGroup, SshHostKey
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

The SSH sessions live on the server. When the user navigates away from `#ssh`, the client may keep WebSocket subscriptions open or drop them; sessions continue either way. When the user navigates back, `useSshSessions` fetches the current live-session list, and each `Terminal` component on mount:

1. Subscribes to its `ptyId` via `ssh:pty.subscribe`.
2. The server responds with a `ssh:pty.data` burst containing the full scrollback ring buffer (up to 256 KiB).
3. xterm renders the buffer, then receives live events.

Scrollback survives because the server retains it per-PTY. Closing a PTY drops the buffer.

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
- Rail SSH item shows a muted pulsing dot when any SSH session is live.
- `SshView` renders left list + right detail in Task Analyst layout.
- Creating a connection opens the form modal, saving persists to SQLite, the new entry appears in the list.
- Password and passphrase fields, when supplied, are encrypted on server (AES-256-GCM), never returned in GETs.
- Group picker in the form supports creating a new group inline. Deleting a group leaves member connections with `group_id = null`.
- Left pane search filters connections by alias/host/username substring (case-insensitive). Groups reduce to members matching the filter; empty groups hidden.
- Selecting a connection and clicking "New Session" opens an SSH client, opens a PTY, renders an xterm. Typing reaches the remote host; remote output renders.
- Jump host works: connection B with `jump_host_id = A` dials A first then tunnels to B. Circular references and multi-level chains rejected at the route layer.
- Port forwards activate on connect (local + remote). Forward errors surface as toasts; the forward row in the connection detail shows `active` / `error` state.
- Multiple PTYs per connection work: tabs switch instantly, no stream cross-talk. Scrollback preserved on tab switch and on re-navigation to `#ssh`.
- Multiple connections open simultaneously: each maintains its own xterm tab state.
- Closing the last tab on a connection disconnects the SSH client and deactivates its forwards.
- Disconnecting triggers the rail indicator to disappear when `liveSessionCount` returns to 0.
- Launching system terminal spawns the native terminal emulator with the correct ssh args per platform:
  - macOS: `osascript` → Terminal.app opens a new tab with `ssh user@host -p port -i keyPath`.
  - Windows: `wt.exe` opens a new tab with the same command; if wt absent, `cmd /c start cmd /k ssh ...`.
  - Linux: first available of gnome-terminal / konsole / x-terminal-emulator / xterm; if none, toast `NO_TERMINAL`.
- Host key TOFU: connecting to a new host prompts; approving saves the fingerprint; subsequent connects silently proceed; forged fingerprint triggers the mismatch modal with expected + actual shown.
- Known hosts panel lists approved entries and supports delete.
- Leaving `#ssh` and returning re-displays the tabs for all still-live sessions; scrollback replays from the server-side buffer.
- Export downloads a valid JSON blob; import with `skip` / `update` strategies updates the DB accordingly; secrets are stripped on export and re-prompted on import.
- On first `#ssh` mount with a readable `~/.sshmaster/connections.json`, a banner offers import; clicking Import runs the migration; clicking Dismiss records the preference and suppresses the banner forever.
- `npm run build` passes. `npm run check:server` passes. ESLint on `web/` introduces zero new errors.
- Cross-platform: test matrix — macOS primary dev target, Linux headless bootstrap test (spawn patterns), Windows code-path guarded (no shell strings, path-join, wt.exe detection).

## Out of Scope (explicitly, future work)

- SFTP / file browser.
- Agent forwarding (`-A`), X11 forwarding.
- Multi-level jump hosts (more than one bastion in the chain).
- OS-keychain integration (master-key-file approach is sufficient per spec).
- GUI terminal theming / font customization beyond xterm defaults.

## Open Questions

None at spec-writing time. Implementation plan will surface concrete tasks.
