# SSH Remote Connection Manager Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Port the sshmaster feature set into the main app as a first-class `#ssh` page (Task Analyst-style layout) with full parity: connection CRUD + groups + PEM/password (encrypted) + multi-session embedded xterm + system terminal launch + port forwarding + jump host + known_hosts TOFU + history + JSON import/export + one-shot migration from `~/.sshmaster`.

**Architecture:** Backend adds `server-ts/src/ssh/` module family plus `routes/ssh.ts` and migration V14. Frontend adds `views/SshView.tsx` with Task Analyst-style two-column layout, `components/ssh/` for cards/modals/terminal, and hooks for connections/sessions/ptys/migration. PTY streaming piggybacks on existing `websocket.ts`. Scrollback preserved via server-side 256 KiB ring buffer per PTY.

**Tech Stack:** Node `ssh2` + `node:crypto` AES-256-GCM (server). `xterm` + `xterm-addon-fit` (web). SQLite V14 migration. Cross-platform: `spawnSync(bin, argsArray)`, per-OS terminal launcher, NTFS-default ACL on Windows master key, `0600` on Unix.

**Verification:** No frontend test framework exists. Each task verifies via `npm run build` (tsc + vite) from the repo root, `npm run check:server` for server changes, `cd web && npx eslint .` at the end. Where a task involves a backend module in isolation, a lightweight `.test.ts` using `node --test` is added to give the subagent a verifiable hook (server-ts already runs tsx; we use `tsx --test` where needed). For UI, verification is typecheck-pass + manual smoke walk at the final task.

**Reference spec:** `docs/superpowers/specs/2026-04-15-ssh-remote-design.md`

**Reference source** (for adapt-from patterns): `/Users/melih/Documents/code/sshmaster/` — specifically `src/main/ssh.js`, `pty.js`, `forwards.js`, `terminal-launcher.js`, `store.js`, `importExport.js`, `ipc.js`. These contain working implementations of the same behaviors; subagents should read them and port the logic, NOT re-design.

---

## Task Ordering Rationale

Tasks ordered so each commit is a working build:

1. Backend foundation (DB, types, crypto, host keys) — pure additions, no wiring.
2. Backend SSH/PTY/forward/launcher modules — unit-testable.
3. Backend HTTP routes + WebSocket wiring — end-to-end functional backend.
4. Backend import/export + sshmaster migration.
5. Frontend deps + types.
6. Frontend hooks.
7. Frontend components (bottom-up: Terminal → Card → Modals → List/Detail → View).
8. Routing + rail REMOTE group + App.tsx wiring.
9. Final verification.

---

## File Structure

### Backend (all under `server-ts/`)

- **Create** `migrations/V14__add_ssh_tables.sql` — groups, connections, forwards, host_keys, history, kv.
- **Create** `src/ssh/types.ts` — shared TypeScript interfaces.
- **Create** `src/ssh/crypto.ts` — AES-256-GCM + master-key file.
- **Create** `src/ssh/hostKeyStore.ts` — fingerprint CRUD.
- **Create** `src/ssh/sshManager.ts` — ssh2 client lifecycle + jump host.
- **Create** `src/ssh/ptyManager.ts` — shell stream + scrollback buffer + subscription.
- **Create** `src/ssh/forwardManager.ts` — local/remote forwards.
- **Create** `src/ssh/terminalLauncher.ts` — per-OS native terminal spawn.
- **Create** `src/ssh/importExport.ts` — JSON serialize/deserialize.
- **Create** `src/ssh/migration.ts` — `~/.sshmaster/connections.json` import.
- **Create** `src/ssh/index.ts` — barrel and singleton wiring.
- **Create** `src/db/ssh.ts` — Db prototype augmentation.
- **Create** `src/routes/ssh.ts` — HTTP routes.
- **Modify** `src/websocket.ts` — add `ssh:pty.*` dispatch.
- **Modify** `src/app.ts` — mount ssh router.
- **Modify** `src/db/index.ts` — register ssh table creation (if schema init uses explicit table list; otherwise only migration file needed).

### Frontend (all under `web/src/`)

- **Create** `views/SshView.tsx` — root view.
- **Create** `components/ssh/ConnectionList.tsx`
- **Create** `components/ssh/ConnectionCard.tsx`
- **Create** `components/ssh/ConnectionDetail.tsx`
- **Create** `components/ssh/SessionTabBar.tsx`
- **Create** `components/ssh/Terminal.tsx`
- **Create** `components/ssh/ConnectionFormModal.tsx`
- **Create** `components/ssh/ForwardsEditor.tsx`
- **Create** `components/ssh/HostKeyPromptModal.tsx`
- **Create** `components/ssh/KnownHostsPanel.tsx`
- **Create** `components/ssh/ImportExportMenu.tsx`
- **Create** `components/ssh/MigrationBanner.tsx`
- **Create** `hooks/useSshConnections.ts`
- **Create** `hooks/useSshSessions.ts`
- **Create** `hooks/useSshPty.ts`
- **Create** `hooks/useSshMigration.ts`
- **Modify** `types.ts` — add SSH types.
- **Modify** `hooks/useHashRoute.ts` — add `"ssh"` route.
- **Modify** `components/SideRail.tsx` — add REMOTE group + `sshLiveCount` prop + indicator.
- **Modify** `App.tsx` — mount view + hooks + pass props.
- **Modify** `web/package.json` — add `ssh2` types (if we import types client-side) and `xterm`, `xterm-addon-fit`.
- **Modify** `package.json` (root or `server-ts/package.json`) — add `ssh2` runtime.

---

## Task 1: Database migration V14

**Files:**
- Create: `server-ts/migrations/V14__add_ssh_tables.sql`

- [ ] **Step 1: Create the migration file**

Use exactly the SQL from the spec (section "Data model"):

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
  password_cipher TEXT,
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
  status TEXT NOT NULL,
  error_code TEXT,
  duration_sec INTEGER
);

CREATE INDEX IF NOT EXISTS idx_ssh_history_conn ON ssh_history(connection_id, attempted_at DESC);

CREATE TABLE IF NOT EXISTS ssh_kv (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
```

- [ ] **Step 2: Verify migration runs**

Run `npm run check:server`. Expected: exits 0.

If the project's migrator runs automatically on dev startup, `npm run dev:server` would normally apply it — but don't start dev here. The migration file existing and typechecking is enough; a later task will exercise it through the DB methods.

- [ ] **Step 3: Commit**

```bash
git add server-ts/migrations/V14__add_ssh_tables.sql
git commit -m "feat(db): add V14 migration for SSH tables"
```

---

## Task 2: Shared SSH types

**Files:**
- Create: `server-ts/src/ssh/types.ts`

- [ ] **Step 1: Create the file**

```typescript
export interface SshGroup {
  id: string;
  name: string;
  createdAt: string;
}

export type AuthType = 'password' | 'key';
export type ForwardType = 'local' | 'remote';

export interface SshForward {
  id: string;
  connectionId: string;
  forwardType: ForwardType;
  bindAddress: string;
  bindPort: number;
  remoteHost: string;
  remotePort: number;
  createdAt: string;
}

export interface SshConnection {
  id: string;
  alias: string;
  groupId: string | null;
  host: string;
  port: number;
  username: string;
  authType: AuthType;
  keyPath: string | null;
  hasPassword: boolean;       // derived from password_cipher !== null
  hasPassphrase: boolean;
  jumpHostId: string | null;
  forwards: SshForward[];
  lastConnectedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SshHostKey {
  host: string;
  port: number;
  fingerprint: string;
  approvedAt: string;
}

export interface SshHistoryEntry {
  id: string;
  connectionId: string;
  attemptedAt: string;
  status: 'connected' | 'failed';
  errorCode: string | null;
  durationSec: number | null;
}

// Live session & PTY — not persisted, returned from sshManager
export interface SshSessionInfo {
  sessionId: string;
  connectionId: string;
  connectedAt: string;
}

export interface SshForwardStatus {
  forwardId: string;
  state: 'active' | 'error';
  message?: string;
}
```

- [ ] **Step 2: Verify**

Run `npm run check:server`. Expected: exits 0.

- [ ] **Step 3: Commit**

```bash
git add server-ts/src/ssh/types.ts
git commit -m "feat(ssh): add shared SSH types"
```

---

## Task 3: Crypto helper (AES-256-GCM + master key)

**Files:**
- Create: `server-ts/src/ssh/crypto.ts`

- [ ] **Step 1: Create the file**

```typescript
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import { appDataDir } from '../paths.js';  // existing helper that returns APP_DATA_DIR path

const MASTER_KEY_FILE = '.ssh_master_key';
const KEY_LEN = 32;
const IV_LEN = 12;
const TAG_LEN = 16;

let cachedKey: Buffer | null = null;

function masterKeyPath(): string {
  return path.join(appDataDir(), MASTER_KEY_FILE);
}

export function getMasterKey(): Buffer {
  if (cachedKey) return cachedKey;
  const p = masterKeyPath();
  try {
    const buf = fs.readFileSync(p);
    if (buf.length !== KEY_LEN) throw new Error('Master key file has wrong length');
    cachedKey = buf;
    return buf;
  } catch (e: any) {
    if (e.code !== 'ENOENT') throw e;
  }
  // Create fresh key
  const key = crypto.randomBytes(KEY_LEN);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  // wx prevents races where two processes create simultaneously
  const fd = fs.openSync(p, 'wx', 0o600);
  try {
    fs.writeSync(fd, key);
  } finally {
    fs.closeSync(fd);
  }
  // Belt & suspenders: ensure perms on Unix (chmod no-op on Windows)
  try { fs.chmodSync(p, 0o600); } catch { /* Windows tolerates */ }
  cachedKey = key;
  return key;
}

export function encrypt(plaintext: string): string {
  const key = getMasterKey();
  const iv = crypto.randomBytes(IV_LEN);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, ct, tag]).toString('base64');
}

export function decrypt(blob: string): string | null {
  try {
    const key = getMasterKey();
    const buf = Buffer.from(blob, 'base64');
    if (buf.length < IV_LEN + TAG_LEN + 1) return null;
    const iv = buf.subarray(0, IV_LEN);
    const tag = buf.subarray(buf.length - TAG_LEN);
    const ct = buf.subarray(IV_LEN, buf.length - TAG_LEN);
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);
    const pt = Buffer.concat([decipher.update(ct), decipher.final()]);
    return pt.toString('utf8');
  } catch {
    return null;  // tampered or wrong master key
  }
}
```

**Note:** `server-ts/src/paths.ts` must export `appDataDir()`. If it doesn't already exist, check `server-ts/src/` for an equivalent (e.g. `dataDir`, `configPath`) — use whatever function produces the app's data directory. If nothing exists, add a small helper `appDataDir.ts`:

```typescript
// server-ts/src/paths.ts
import * as os from 'node:os';
import * as path from 'node:path';
export function appDataDir(): string {
  const envOverride = process.env.APP_DATA_DIR;
  if (envOverride) return envOverride;
  if (process.platform === 'win32') return path.join(process.env.APPDATA || os.homedir(), 'branching-bad');
  if (process.platform === 'darwin') return path.join(os.homedir(), 'Library', 'Application Support', 'branching-bad');
  return path.join(os.homedir(), '.local', 'share', 'branching-bad');
}
```

Search the codebase for an existing equivalent before creating this helper — if `db/index.ts` or similar computes this inline, extract it to `paths.ts` and reuse.

- [ ] **Step 2: Verify**

Run `npm run check:server`. Expected: exits 0.

- [ ] **Step 3: Unit test**

Create `server-ts/src/ssh/crypto.test.ts`:

```typescript
import { test } from 'node:test';
import assert from 'node:assert';
import * as os from 'node:os';
import * as path from 'node:path';
import * as fs from 'node:fs';

// Isolate master key dir per test run
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ssh-crypto-test-'));
process.env.APP_DATA_DIR = tmpDir;

const { encrypt, decrypt } = await import('./crypto.js');

test('encrypt/decrypt round-trip', () => {
  const plain = 'hunter2';
  const blob = encrypt(plain);
  assert.notStrictEqual(blob, plain);
  assert.strictEqual(decrypt(blob), plain);
});

test('decrypt returns null for tampered blob', () => {
  const blob = encrypt('secret');
  const tampered = Buffer.from(blob, 'base64');
  tampered[tampered.length - 1] ^= 0xff;
  assert.strictEqual(decrypt(tampered.toString('base64')), null);
});

test('empty string round-trip', () => {
  const blob = encrypt('');
  assert.strictEqual(decrypt(blob), '');
});

test('unicode round-trip', () => {
  const s = 'pässwörd🔐';
  assert.strictEqual(decrypt(encrypt(s)), s);
});
```

Run: `cd server-ts && npx tsx --test src/ssh/crypto.test.ts`
Expected: 4 passing tests.

- [ ] **Step 4: Commit**

```bash
git add server-ts/src/ssh/crypto.ts server-ts/src/ssh/crypto.test.ts server-ts/src/paths.ts
git commit -m "feat(ssh): AES-256-GCM crypto + master key file"
```

(If `paths.ts` wasn't needed because an existing helper worked, drop it from the `git add`.)

---

## Task 4: DB methods for SSH tables

**Files:**
- Create: `server-ts/src/db/ssh.ts`

This file augments `Db` with all SSH-related CRUD. Follows the existing `declare module` pattern (see `server-ts/src/provider/dbItems.ts` for the template).

- [ ] **Step 1: Create the file**

Read `server-ts/src/provider/dbItems.ts` first as the canonical example of the augmentation pattern. Then create:

```typescript
import { Db, nowIso } from '../db/index.js';
import { v4 as uuidv4 } from 'uuid';
import type {
  SshGroup, SshConnection, SshForward, SshHostKey, SshHistoryEntry, AuthType, ForwardType,
} from '../ssh/types.js';

declare module '../db/index.js' {
  interface Db {
    // Groups
    listSshGroups(): SshGroup[];
    createSshGroup(name: string): SshGroup;
    renameSshGroup(id: string, name: string): void;
    deleteSshGroup(id: string): void;

    // Connections
    listSshConnections(): SshConnection[];
    getSshConnection(id: string): SshConnection | null;
    createSshConnection(input: SshConnectionInput): SshConnection;
    updateSshConnection(id: string, patch: Partial<SshConnectionInput>): SshConnection;
    deleteSshConnection(id: string): void;
    setSshConnectionLastConnected(id: string, at: string): void;

    // Forwards (owned by connection; CRUD via full-replace on connection update)
    replaceSshConnectionForwards(connectionId: string, forwards: Omit<SshForward, 'id' | 'connectionId' | 'createdAt'>[]): SshForward[];

    // Raw ciphers (internal, used only by routes to read before decrypt)
    getSshConnectionCiphers(id: string): { password_cipher: string | null; passphrase_cipher: string | null };

    // Host keys
    listSshHostKeys(): SshHostKey[];
    findSshHostKey(host: string, port: number): SshHostKey | null;
    approveSshHostKey(host: string, port: number, fingerprint: string): void;
    deleteSshHostKey(host: string, port: number): void;

    // History
    appendSshHistory(entry: Omit<SshHistoryEntry, 'id'>): void;
    listSshHistory(limit: number): SshHistoryEntry[];

    // KV
    getSshKv(key: string): string | null;
    setSshKv(key: string, value: string): void;
  }
}

export interface SshConnectionInput {
  alias: string;
  groupId: string | null;
  host: string;
  port: number;
  username: string;
  authType: AuthType;
  keyPath: string | null;
  passwordCipher: string | null;
  hasPassphrase: boolean;
  passphraseCipher: string | null;
  jumpHostId: string | null;
  forwards: Omit<SshForward, 'id' | 'connectionId' | 'createdAt'>[];
}

// --- Implementations below ---

function rowToGroup(r: any): SshGroup {
  return { id: r.id, name: r.name, createdAt: r.created_at };
}

function rowToForward(r: any): SshForward {
  return {
    id: r.id,
    connectionId: r.connection_id,
    forwardType: r.forward_type as ForwardType,
    bindAddress: r.bind_address,
    bindPort: r.bind_port,
    remoteHost: r.remote_host,
    remotePort: r.remote_port,
    createdAt: r.created_at,
  };
}

function rowToConnection(r: any, forwards: SshForward[]): SshConnection {
  return {
    id: r.id,
    alias: r.alias,
    groupId: r.group_id,
    host: r.host,
    port: r.port,
    username: r.username,
    authType: r.auth_type as AuthType,
    keyPath: r.key_path,
    hasPassword: r.password_cipher !== null,
    hasPassphrase: r.has_passphrase === 1,
    jumpHostId: r.jump_host_id,
    forwards,
    lastConnectedAt: r.last_connected_at,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

Db.prototype.listSshGroups = function () {
  return (this.connect().prepare('SELECT * FROM ssh_groups ORDER BY name').all() as any[]).map(rowToGroup);
};

Db.prototype.createSshGroup = function (name: string) {
  const db = this.connect();
  const id = uuidv4();
  const ts = nowIso();
  db.prepare('INSERT INTO ssh_groups(id, name, created_at) VALUES(?, ?, ?)').run(id, name, ts);
  return { id, name, createdAt: ts };
};

Db.prototype.renameSshGroup = function (id: string, name: string) {
  this.connect().prepare('UPDATE ssh_groups SET name = ? WHERE id = ?').run(name, id);
};

Db.prototype.deleteSshGroup = function (id: string) {
  this.connect().prepare('DELETE FROM ssh_groups WHERE id = ?').run(id);
};

Db.prototype.listSshConnections = function () {
  const db = this.connect();
  const rows = db.prepare('SELECT * FROM ssh_connections ORDER BY alias').all() as any[];
  const fwds = db.prepare('SELECT * FROM ssh_forwards').all() as any[];
  const byConn = new Map<string, SshForward[]>();
  for (const f of fwds) {
    const arr = byConn.get(f.connection_id) ?? [];
    arr.push(rowToForward(f));
    byConn.set(f.connection_id, arr);
  }
  return rows.map((r) => rowToConnection(r, byConn.get(r.id) ?? []));
};

Db.prototype.getSshConnection = function (id: string) {
  const db = this.connect();
  const r = db.prepare('SELECT * FROM ssh_connections WHERE id = ?').get(id) as any;
  if (!r) return null;
  const fwds = (db.prepare('SELECT * FROM ssh_forwards WHERE connection_id = ?').all(id) as any[]).map(rowToForward);
  return rowToConnection(r, fwds);
};

Db.prototype.createSshConnection = function (input: SshConnectionInput) {
  const db = this.connect();
  const id = uuidv4();
  const ts = nowIso();
  db.prepare(`INSERT INTO ssh_connections(
    id, alias, group_id, host, port, username, auth_type, key_path,
    password_cipher, has_passphrase, passphrase_cipher, jump_host_id,
    last_connected_at, created_at, updated_at
  ) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)`).run(
    id, input.alias, input.groupId, input.host, input.port, input.username,
    input.authType, input.keyPath,
    input.passwordCipher, input.hasPassphrase ? 1 : 0, input.passphraseCipher,
    input.jumpHostId, ts, ts,
  );
  const forwards = this.replaceSshConnectionForwards(id, input.forwards);
  const conn = this.getSshConnection(id);
  if (!conn) throw new Error('failed to read back created connection');
  return conn;
};

Db.prototype.updateSshConnection = function (id: string, patch: Partial<SshConnectionInput>) {
  const db = this.connect();
  const existing = this.getSshConnection(id);
  if (!existing) throw new Error('connection not found');
  const ts = nowIso();
  const sets: string[] = [];
  const params: any[] = [];
  const colMap: Record<keyof SshConnectionInput, string> = {
    alias: 'alias', groupId: 'group_id', host: 'host', port: 'port', username: 'username',
    authType: 'auth_type', keyPath: 'key_path', passwordCipher: 'password_cipher',
    hasPassphrase: 'has_passphrase', passphraseCipher: 'passphrase_cipher', jumpHostId: 'jump_host_id',
    forwards: '',  // handled separately
  };
  for (const k of Object.keys(patch) as (keyof SshConnectionInput)[]) {
    if (k === 'forwards') continue;
    const col = colMap[k];
    if (!col) continue;
    sets.push(`${col} = ?`);
    let v: any = (patch as any)[k];
    if (k === 'hasPassphrase') v = v ? 1 : 0;
    params.push(v);
  }
  sets.push('updated_at = ?');
  params.push(ts);
  params.push(id);
  if (sets.length > 1) {
    db.prepare(`UPDATE ssh_connections SET ${sets.join(', ')} WHERE id = ?`).run(...params);
  }
  if (patch.forwards) this.replaceSshConnectionForwards(id, patch.forwards);
  const updated = this.getSshConnection(id);
  if (!updated) throw new Error('failed to read back updated connection');
  return updated;
};

Db.prototype.deleteSshConnection = function (id: string) {
  this.connect().prepare('DELETE FROM ssh_connections WHERE id = ?').run(id);
};

Db.prototype.setSshConnectionLastConnected = function (id: string, at: string) {
  this.connect().prepare('UPDATE ssh_connections SET last_connected_at = ? WHERE id = ?').run(at, id);
};

Db.prototype.replaceSshConnectionForwards = function (connectionId: string, forwards) {
  const db = this.connect();
  const ts = nowIso();
  db.prepare('DELETE FROM ssh_forwards WHERE connection_id = ?').run(connectionId);
  const insert = db.prepare(`INSERT INTO ssh_forwards(
    id, connection_id, forward_type, bind_address, bind_port, remote_host, remote_port, created_at
  ) VALUES(?, ?, ?, ?, ?, ?, ?, ?)`);
  const result: SshForward[] = [];
  for (const f of forwards) {
    const id = uuidv4();
    insert.run(id, connectionId, f.forwardType, f.bindAddress, f.bindPort, f.remoteHost, f.remotePort, ts);
    result.push({ id, connectionId, ...f, createdAt: ts });
  }
  return result;
};

Db.prototype.getSshConnectionCiphers = function (id: string) {
  const row = this.connect().prepare(
    'SELECT password_cipher, passphrase_cipher FROM ssh_connections WHERE id = ?',
  ).get(id) as any;
  return {
    password_cipher: row?.password_cipher ?? null,
    passphrase_cipher: row?.passphrase_cipher ?? null,
  };
};

Db.prototype.listSshHostKeys = function () {
  const rows = this.connect().prepare('SELECT * FROM ssh_host_keys ORDER BY host, port').all() as any[];
  return rows.map((r) => ({ host: r.host, port: r.port, fingerprint: r.fingerprint, approvedAt: r.approved_at }));
};

Db.prototype.findSshHostKey = function (host: string, port: number) {
  const r = this.connect().prepare('SELECT * FROM ssh_host_keys WHERE host = ? AND port = ?').get(host, port) as any;
  if (!r) return null;
  return { host: r.host, port: r.port, fingerprint: r.fingerprint, approvedAt: r.approved_at };
};

Db.prototype.approveSshHostKey = function (host: string, port: number, fingerprint: string) {
  const ts = nowIso();
  this.connect().prepare(
    'INSERT INTO ssh_host_keys(host, port, fingerprint, approved_at) VALUES(?, ?, ?, ?) ON CONFLICT(host, port) DO UPDATE SET fingerprint = excluded.fingerprint, approved_at = excluded.approved_at',
  ).run(host, port, fingerprint, ts);
};

Db.prototype.deleteSshHostKey = function (host: string, port: number) {
  this.connect().prepare('DELETE FROM ssh_host_keys WHERE host = ? AND port = ?').run(host, port);
};

Db.prototype.appendSshHistory = function (entry) {
  const id = uuidv4();
  this.connect().prepare(
    'INSERT INTO ssh_history(id, connection_id, attempted_at, status, error_code, duration_sec) VALUES(?, ?, ?, ?, ?, ?)',
  ).run(id, entry.connectionId, entry.attemptedAt, entry.status, entry.errorCode, entry.durationSec);
};

Db.prototype.listSshHistory = function (limit: number) {
  const rows = this.connect().prepare(
    'SELECT * FROM ssh_history ORDER BY attempted_at DESC LIMIT ?',
  ).all(limit) as any[];
  return rows.map((r) => ({
    id: r.id, connectionId: r.connection_id, attemptedAt: r.attempted_at,
    status: r.status, errorCode: r.error_code, durationSec: r.duration_sec,
  }));
};

Db.prototype.getSshKv = function (key: string) {
  const r = this.connect().prepare('SELECT value FROM ssh_kv WHERE key = ?').get(key) as any;
  return r?.value ?? null;
};

Db.prototype.setSshKv = function (key: string, value: string) {
  const ts = nowIso();
  this.connect().prepare(
    'INSERT INTO ssh_kv(key, value, updated_at) VALUES(?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at',
  ).run(key, value, ts);
};
```

- [ ] **Step 2: Register this module with Db**

Find the file that imports all `db/*` augmentations (likely `server-ts/src/db/index.ts` or `server-ts/src/state.ts`). Add `import '../db/ssh.js';` alongside other augmentation imports. (The existing provider/dbItems.ts pattern will guide you — search for `import './dbItems` or similar.)

- [ ] **Step 3: Verify**

Run `npm run check:server`. Expected: exits 0.

- [ ] **Step 4: Commit**

```bash
git add server-ts/src/db/ssh.ts server-ts/src/db/index.ts server-ts/src/state.ts 2>/dev/null
git commit -m "feat(db): SSH CRUD, forwards, host keys, history, kv"
```

(Include only files that were actually modified.)

---

## Task 5: Host key store

**Files:**
- Create: `server-ts/src/ssh/hostKeyStore.ts`

- [ ] **Step 1: Create the file**

```typescript
import * as crypto from 'node:crypto';
import type { Db } from '../db/index.js';

export function fingerprintOf(hostKey: Buffer | string): string {
  const data = typeof hostKey === 'string' ? Buffer.from(hostKey) : hostKey;
  return 'SHA256:' + crypto.createHash('sha256').update(data).digest('base64').replace(/=+$/, '');
}

export type HostKeyCheck = 'unknown' | 'match' | 'mismatch';

export function createHostKeyStore(db: Db) {
  return {
    check(host: string, port: number, fingerprint: string): HostKeyCheck {
      const known = db.findSshHostKey(host, port);
      if (!known) return 'unknown';
      return known.fingerprint === fingerprint ? 'match' : 'mismatch';
    },
    approve(host: string, port: number, fingerprint: string): void {
      db.approveSshHostKey(host, port, fingerprint);
    },
    list() { return db.listSshHostKeys(); },
    delete(host: string, port: number) { db.deleteSshHostKey(host, port); },
  };
}

export type HostKeyStore = ReturnType<typeof createHostKeyStore>;
```

- [ ] **Step 2: Verify**

Run `npm run check:server`. Expected: exits 0.

- [ ] **Step 3: Commit**

```bash
git add server-ts/src/ssh/hostKeyStore.ts
git commit -m "feat(ssh): host key store with SHA256 fingerprint checks"
```

---

## Task 6: SSH client manager

**Files:**
- Create: `server-ts/src/ssh/sshManager.ts`

**Reference:** `/Users/melih/Documents/code/sshmaster/src/main/ssh.js` — port the `createSshManager` factory. Keep `verifyHostKey`, `dialOnce` (with `hostVerifier`), `connect` (with jump-host chaining), `disconnect`, `get`, `list`. Key differences from sshmaster:

- Types: TypeScript with `SshConnection` from `./types.js`.
- Host key verification: use `HostKeyStore` from Task 5 instead of inline store. On `unknown` or `mismatch`, the function should NOT prompt — it should reject with `HOST_KEY_PROMPT` error carrying `{ host, port, fingerprint, kind, expected? }`. The route layer (Task 10) surfaces this to the client for approval.
- Auth resolution: `keyPath` is read via `fs.readFileSync(keyPath)` on demand. For password/passphrase, accept already-decrypted plaintext from the caller (decryption happens in the route layer, not here — keeps this module single-responsibility).
- Input shape: `connect(input: { conn: SshConnection, password?: string, passphrase?: string, jumpHost?: SshConnection, jumpHostSecrets?: { password?: string; passphrase?: string } })`.

- [ ] **Step 1: Create the file**

```typescript
import { Client } from 'ssh2';
import * as fs from 'node:fs';
import * as crypto from 'node:crypto';
import type { SshConnection, SshSessionInfo } from './types.js';
import { fingerprintOf, type HostKeyStore, type HostKeyCheck } from './hostKeyStore.js';

export class HostKeyPromptError extends Error {
  constructor(
    public host: string,
    public port: number,
    public fingerprint: string,
    public kind: 'unknown' | 'mismatch',
    public expected?: string,
  ) {
    super(`HOST_KEY_PROMPT: ${host}:${port} ${kind}`);
    this.name = 'HostKeyPromptError';
  }
}

export class SshError extends Error {
  constructor(public code: string, message: string) { super(message); this.name = 'SshError'; }
}

function wrapError(err: any): SshError {
  const msg = String(err?.message ?? err);
  let code = 'UNKNOWN';
  if (/authentication/i.test(msg)) code = 'AUTH_FAILED';
  else if (/ENOTFOUND|ECONNREFUSED|EHOSTUNREACH|ETIMEDOUT/i.test(msg)) code = 'HOST_UNREACHABLE';
  else if (/Timed out/i.test(msg)) code = 'TIMEOUT';
  return new SshError(code, msg);
}

export interface ConnectInput {
  conn: SshConnection;
  password?: string;
  passphrase?: string;
  jumpHost?: SshConnection;
  jumpHostSecrets?: { password?: string; passphrase?: string };
}

interface Session {
  connectionId: string;
  client: Client;
  connectedAt: string;
  bastion?: Client;
}

export function createSshManager({ hostKeys }: { hostKeys: HostKeyStore }) {
  const sessions = new Map<string, Session>();

  function buildAuth(conn: SshConnection, password?: string, passphrase?: string) {
    const opts: any = {
      host: conn.host, port: conn.port, username: conn.username, readyTimeout: 15000,
    };
    if (conn.authType === 'password') {
      if (password === undefined || password === '') {
        throw new SshError('AUTH_FAILED', 'Password not provided');
      }
      opts.password = password;
    } else {
      if (!conn.keyPath) throw new SshError('AUTH_FAILED', 'Key path not set');
      try {
        opts.privateKey = fs.readFileSync(conn.keyPath);
      } catch (e: any) {
        throw new SshError('KEY_READ_ERROR', e.message);
      }
      if (conn.hasPassphrase && passphrase) opts.passphrase = passphrase;
    }
    return opts;
  }

  function dialOnce(conn: SshConnection, password: string | undefined, passphrase: string | undefined, sock?: any): Promise<Client> {
    const opts = buildAuth(conn, password, passphrase);
    if (sock) opts.sock = sock;

    let hostKeyError: Error | null = null;
    opts.hostVerifier = (key: any, cb: (ok: boolean) => void) => {
      // ssh2 may pass Buffer | string; normalize
      const fp = fingerprintOf(Buffer.isBuffer(key) ? key : Buffer.from(key));
      const check: HostKeyCheck = hostKeys.check(conn.host, conn.port, fp);
      if (check === 'match') { cb(true); return; }
      if (check === 'unknown') {
        hostKeyError = new HostKeyPromptError(conn.host, conn.port, fp, 'unknown');
      } else {
        const known = hostKeys.list().find((k) => k.host === conn.host && k.port === conn.port);
        hostKeyError = new HostKeyPromptError(conn.host, conn.port, fp, 'mismatch', known?.fingerprint);
      }
      cb(false);
    };

    return new Promise<Client>((resolve, reject) => {
      const client = new Client();
      let settled = false;
      client.on('ready', () => { settled = true; resolve(client); });
      client.on('error', (e) => {
        if (settled) return;
        settled = true;
        try { client.end(); } catch {}
        if (hostKeyError) return reject(hostKeyError);
        reject(wrapError(e));
      });
      client.on('close', () => {});
      client.connect(opts);
    });
  }

  async function connect(input: ConnectInput): Promise<{ sessionId: string }> {
    const { conn, password, passphrase, jumpHost, jumpHostSecrets } = input;
    let client: Client;
    let bastion: Client | undefined;
    if (jumpHost) {
      bastion = await dialOnce(jumpHost, jumpHostSecrets?.password, jumpHostSecrets?.passphrase);
      const sock = await new Promise<any>((resolve, reject) => {
        bastion!.forwardOut('127.0.0.1', 0, conn.host, conn.port, (err, stream) => {
          if (err) reject(new SshError('JUMP_HOST_FAILED', err.message));
          else resolve(stream);
        });
      });
      try {
        client = await dialOnce(conn, password, passphrase, sock);
      } catch (e) {
        bastion.end();
        throw e;
      }
    } else {
      client = await dialOnce(conn, password, passphrase);
    }

    const sessionId = crypto.randomUUID();
    const session: Session = {
      connectionId: conn.id,
      client,
      connectedAt: new Date().toISOString(),
      bastion,
    };
    sessions.set(sessionId, session);
    client.on('close', () => {
      sessions.delete(sessionId);
      session.bastion?.end();
    });
    return { sessionId };
  }

  async function disconnect(sessionId: string): Promise<void> {
    const s = sessions.get(sessionId);
    if (!s) return;
    s.client.end();
    s.bastion?.end();
    sessions.delete(sessionId);
  }

  function get(sessionId: string): Session | null {
    return sessions.get(sessionId) ?? null;
  }

  function list(): SshSessionInfo[] {
    return Array.from(sessions.entries()).map(([sessionId, s]) => ({
      sessionId, connectionId: s.connectionId, connectedAt: s.connectedAt,
    }));
  }

  return { connect, disconnect, get, list };
}

export type SshManager = ReturnType<typeof createSshManager>;
```

- [ ] **Step 2: Verify**

Run `npm run check:server`. Expected: exits 0. ssh2 types come from `@types/ssh2` (added as dep in Task 16); if typecheck complains about missing types here, move ssh2 type imports to a separate declaration file or add `// @ts-ignore` where needed — but first check whether `@types/ssh2` was already installed by a previous task. If not, `npm i -D @types/ssh2` in `server-ts/`.

- [ ] **Step 3: Commit**

```bash
git add server-ts/src/ssh/sshManager.ts server-ts/package.json server-ts/package-lock.json 2>/dev/null
git commit -m "feat(ssh): SSH client manager with jump-host chaining"
```

---

## Task 7: PTY manager with scrollback ring buffer

**Files:**
- Create: `server-ts/src/ssh/ptyManager.ts`

**Reference:** `/Users/melih/Documents/code/sshmaster/src/main/pty.js` — basic shell stream wrapping. This task adds a scrollback ring buffer (256 KiB cap) and subscriber fan-out.

- [ ] **Step 1: Create the file**

```typescript
import * as crypto from 'node:crypto';
import type { SshManager } from './sshManager.js';

const SCROLLBACK_CAP = 256 * 1024;

interface Pty {
  sessionId: string;
  stream: any;                              // ssh2 ClientChannel
  buffer: Buffer;                           // ring buffer
  subscribers: Set<(data: string) => void>;
  closedSubscribers: Set<() => void>;
  closed: boolean;
}

export function createPtyManager({ ssh }: { ssh: SshManager }) {
  const ptys = new Map<string, Pty>();

  function appendBuffer(pty: Pty, chunk: Buffer) {
    if (chunk.length >= SCROLLBACK_CAP) {
      pty.buffer = chunk.subarray(chunk.length - SCROLLBACK_CAP);
      return;
    }
    const combined = Buffer.concat([pty.buffer, chunk]);
    if (combined.length > SCROLLBACK_CAP) {
      pty.buffer = combined.subarray(combined.length - SCROLLBACK_CAP);
    } else {
      pty.buffer = combined;
    }
  }

  async function openShell(sessionId: string, opts: { cols: number; rows: number }): Promise<{ ptyId: string }> {
    const session = ssh.get(sessionId);
    if (!session) throw new Error('PTY_OPEN_FAILED: session not found');

    const stream: any = await new Promise((resolve, reject) => {
      session.client.shell(
        { cols: opts.cols, rows: opts.rows, term: 'xterm-256color' },
        (err, s) => (err ? reject(new Error('PTY_OPEN_FAILED: ' + err.message)) : resolve(s)),
      );
    });

    const ptyId = crypto.randomUUID();
    const pty: Pty = {
      sessionId,
      stream,
      buffer: Buffer.alloc(0),
      subscribers: new Set(),
      closedSubscribers: new Set(),
      closed: false,
    };
    ptys.set(ptyId, pty);

    stream.on('data', (d: Buffer) => {
      appendBuffer(pty, d);
      const s = d.toString('utf8');
      for (const sub of pty.subscribers) {
        try { sub(s); } catch {}
      }
    });
    stream.stderr?.on('data', (d: Buffer) => {
      appendBuffer(pty, d);
      const s = d.toString('utf8');
      for (const sub of pty.subscribers) {
        try { sub(s); } catch {}
      }
    });
    stream.on('close', () => {
      pty.closed = true;
      for (const sub of pty.closedSubscribers) {
        try { sub(); } catch {}
      }
      ptys.delete(ptyId);
    });

    return { ptyId };
  }

  function write(ptyId: string, data: string): void {
    const pty = ptys.get(ptyId);
    if (!pty || pty.closed) return;
    pty.stream.write(data);
  }

  function resize(ptyId: string, cols: number, rows: number): void {
    const pty = ptys.get(ptyId);
    if (!pty || pty.closed) return;
    pty.stream.setWindow(rows, cols, 0, 0);
  }

  function close(ptyId: string): void {
    const pty = ptys.get(ptyId);
    if (!pty || pty.closed) return;
    try { pty.stream.end(); } catch {}
  }

  function subscribe(
    ptyId: string,
    onData: (data: string) => void,
    onClose: () => void,
  ): () => void {
    const pty = ptys.get(ptyId);
    if (!pty) { onClose(); return () => {}; }
    // Replay buffer first
    if (pty.buffer.length > 0) {
      try { onData(pty.buffer.toString('utf8')); } catch {}
    }
    if (pty.closed) { onClose(); return () => {}; }
    pty.subscribers.add(onData);
    pty.closedSubscribers.add(onClose);
    return () => {
      pty.subscribers.delete(onData);
      pty.closedSubscribers.delete(onClose);
    };
  }

  function listForSession(sessionId: string): { ptyId: string }[] {
    const out: { ptyId: string }[] = [];
    for (const [id, p] of ptys) if (p.sessionId === sessionId) out.push({ ptyId: id });
    return out;
  }

  function closeAllForSession(sessionId: string): void {
    for (const [id, p] of ptys) if (p.sessionId === sessionId) {
      try { p.stream.end(); } catch {}
      ptys.delete(id);
    }
  }

  return { openShell, write, resize, close, subscribe, listForSession, closeAllForSession };
}

export type PtyManager = ReturnType<typeof createPtyManager>;
```

- [ ] **Step 2: Verify**

Run `npm run check:server`. Expected: exits 0.

- [ ] **Step 3: Commit**

```bash
git add server-ts/src/ssh/ptyManager.ts
git commit -m "feat(ssh): PTY manager with 256KiB scrollback ring buffer"
```

---

## Task 8: Forward manager

**Files:**
- Create: `server-ts/src/ssh/forwardManager.ts`

**Reference:** `/Users/melih/Documents/code/sshmaster/src/main/forwards.js` — port `createForwardManager` with `activate`, `deactivate`, `deactivateAll`, `status`. Local forwards use `net.createServer` per bind port + `client.forwardOut`; remote forwards use `client.forwardIn`.

- [ ] **Step 1: Create the file**

Port the JS source into TypeScript. Signature:

```typescript
import * as net from 'node:net';
import type { SshManager } from './sshManager.js';
import type { SshForward, SshForwardStatus, ForwardType } from './types.js';

interface ActiveLocal {
  server: net.Server;
  forwardId: string;
  type: 'local';
}

interface ActiveRemote {
  forwardId: string;
  type: 'remote';
  bindAddress: string;
  bindPort: number;
}

export function createForwardManager({ ssh }: { ssh: SshManager }) {
  const bySession = new Map<string, { active: (ActiveLocal | ActiveRemote)[]; errors: Map<string, string> }>();

  function getState(sessionId: string) {
    let s = bySession.get(sessionId);
    if (!s) { s = { active: [], errors: new Map() }; bySession.set(sessionId, s); }
    return s;
  }

  async function activate(sessionId: string, fwd: SshForward): Promise<void> {
    const session = ssh.get(sessionId);
    if (!session) throw new Error('FORWARD_FAILED: session not found');
    const state = getState(sessionId);

    if (fwd.forwardType === 'local') {
      const server = net.createServer((local) => {
        session.client.forwardOut(
          fwd.bindAddress, fwd.bindPort, fwd.remoteHost, fwd.remotePort,
          (err, remote) => {
            if (err) { local.destroy(err); return; }
            local.pipe(remote).pipe(local);
          },
        );
      });
      await new Promise<void>((resolve, reject) => {
        server.once('error', (e) => reject(new Error('FORWARD_FAILED: ' + e.message)));
        server.listen(fwd.bindPort, fwd.bindAddress, () => resolve());
      });
      state.active.push({ server, forwardId: fwd.id, type: 'local' });
    } else {
      await new Promise<void>((resolve, reject) => {
        session.client.forwardIn(fwd.bindAddress, fwd.bindPort, (err) => {
          if (err) reject(new Error('FORWARD_FAILED: ' + err.message));
          else resolve();
        });
      });
      // ssh2 emits 'tcp connection' on the client for each incoming remote conn.
      // Wire it once per session (idempotent):
      if (!(session.client as any).__forwardInWired) {
        (session.client as any).__forwardInWired = true;
        (session.client as any).on('tcp connection', (info: any, accept: any) => {
          const stream = accept();
          const target = net.connect(fwd.remotePort, fwd.remoteHost, () => {
            stream.pipe(target).pipe(stream);
          });
          target.on('error', () => stream.end());
        });
      }
      state.active.push({ forwardId: fwd.id, type: 'remote', bindAddress: fwd.bindAddress, bindPort: fwd.bindPort });
    }
  }

  async function deactivate(sessionId: string, forwardId: string): Promise<void> {
    const state = bySession.get(sessionId);
    if (!state) return;
    const idx = state.active.findIndex((a) => a.forwardId === forwardId);
    if (idx < 0) return;
    const entry = state.active[idx];
    if (entry.type === 'local') {
      await new Promise<void>((resolve) => entry.server.close(() => resolve()));
    } else {
      const session = ssh.get(sessionId);
      if (session) {
        await new Promise<void>((resolve) => session.client.unforwardIn(entry.bindAddress, entry.bindPort, () => resolve()));
      }
    }
    state.active.splice(idx, 1);
  }

  async function deactivateAll(sessionId: string): Promise<void> {
    const state = bySession.get(sessionId);
    if (!state) return;
    for (const entry of [...state.active]) {
      await deactivate(sessionId, entry.forwardId);
    }
    bySession.delete(sessionId);
  }

  function status(sessionId: string): SshForwardStatus[] {
    const state = bySession.get(sessionId);
    if (!state) return [];
    const out: SshForwardStatus[] = [];
    for (const entry of state.active) {
      out.push({ forwardId: entry.forwardId, state: 'active' });
    }
    for (const [id, msg] of state.errors) {
      out.push({ forwardId: id, state: 'error', message: msg });
    }
    return out;
  }

  function recordError(sessionId: string, forwardId: string, message: string): void {
    getState(sessionId).errors.set(forwardId, message);
  }

  return { activate, deactivate, deactivateAll, status, recordError };
}

export type ForwardManager = ReturnType<typeof createForwardManager>;
```

- [ ] **Step 2: Verify**

Run `npm run check:server`. Expected: exits 0.

- [ ] **Step 3: Commit**

```bash
git add server-ts/src/ssh/forwardManager.ts
git commit -m "feat(ssh): port forwarding manager (local + remote)"
```

---

## Task 9: Terminal launcher (cross-platform)

**Files:**
- Create: `server-ts/src/ssh/terminalLauncher.ts`

**Reference:** `/Users/melih/Documents/code/sshmaster/src/main/terminal-launcher.js`. Port the per-OS spawn logic. Must handle:
- macOS via osascript to Terminal.app.
- Windows: `wt.exe` (Windows Terminal) first; fallback `cmd /c start cmd /k ssh ...`.
- Linux: try `gnome-terminal`, `konsole`, `x-terminal-emulator`, `xterm` in order.

- [ ] **Step 1: Create the file**

```typescript
import { spawnSync, spawn } from 'node:child_process';
import type { SshConnection } from './types.js';

function buildSshArgs(target: SshConnection, jump?: SshConnection | null): string[] {
  const args: string[] = [];
  if (target.port !== 22) { args.push('-p', String(target.port)); }
  if (target.authType === 'key' && target.keyPath) { args.push('-i', target.keyPath); }
  if (jump) {
    const jumpSpec = `${jump.username}@${jump.host}${jump.port !== 22 ? ':' + jump.port : ''}`;
    args.push('-J', jumpSpec);
  }
  args.push(`${target.username}@${target.host}`);
  return args;
}

function which(bin: string): boolean {
  const probe = process.platform === 'win32'
    ? spawnSync('where', [bin], { stdio: 'ignore' })
    : spawnSync('which', [bin], { stdio: 'ignore' });
  return probe.status === 0;
}

export function launchSystemTerminal(target: SshConnection, jump?: SshConnection | null): void {
  const args = buildSshArgs(target, jump);
  const sshCmd = ['ssh', ...args];

  if (process.platform === 'darwin') {
    // Build a shell-safe command string for osascript using shell quoting
    const cmd = sshCmd.map((a) => `'${a.replace(/'/g, `'\\''`)}'`).join(' ');
    const osa = `tell application "Terminal" to do script "${cmd.replace(/"/g, '\\"')}"\nactivate application "Terminal"`;
    const r = spawnSync('osascript', ['-e', osa], { stdio: 'ignore' });
    if (r.status !== 0) throw new Error('LAUNCH_FAILED: osascript exited ' + r.status);
    return;
  }

  if (process.platform === 'win32') {
    if (which('wt.exe') || which('wt')) {
      const r = spawnSync('wt.exe', ['-w', '0', 'nt', ...sshCmd], { stdio: 'ignore', shell: false });
      if (r.status === 0) return;
    }
    // Fallback to cmd
    const r = spawnSync('cmd', ['/c', 'start', 'cmd', '/k', ...sshCmd], { stdio: 'ignore' });
    if (r.status !== 0) throw new Error('LAUNCH_FAILED: cmd start exited ' + r.status);
    return;
  }

  // Linux
  const candidates = [
    { bin: 'gnome-terminal', args: ['--', ...sshCmd] },
    { bin: 'konsole', args: ['-e', ...sshCmd] },
    { bin: 'x-terminal-emulator', args: ['-e', ...sshCmd] },
    { bin: 'xterm', args: ['-e', ...sshCmd] },
  ];
  for (const { bin, args: a } of candidates) {
    if (which(bin)) {
      // detached so the app doesn't hold the process
      spawn(bin, a, { stdio: 'ignore', detached: true }).unref();
      return;
    }
  }
  const e = new Error('NO_TERMINAL: no known terminal emulator found');
  (e as any).code = 'NO_TERMINAL';
  throw e;
}
```

- [ ] **Step 2: Verify**

Run `npm run check:server`. Expected: exits 0.

- [ ] **Step 3: Commit**

```bash
git add server-ts/src/ssh/terminalLauncher.ts
git commit -m "feat(ssh): cross-platform system terminal launcher"
```

---

## Task 10: Import/export + sshmaster migration

**Files:**
- Create: `server-ts/src/ssh/importExport.ts`
- Create: `server-ts/src/ssh/migration.ts`

**Reference for importExport:** `/Users/melih/Documents/code/sshmaster/src/main/importExport.js` (simple serialize/deserialize with strategy switch).

**Reference for migration:** `/Users/melih/Documents/code/sshmaster/src/main/store.js` — understand the sshmaster JSON shape (`connections: [...], groups: [...], knownHosts: [...], history: [...]`), then port as a one-way importer.

- [ ] **Step 1: Create `importExport.ts`**

```typescript
import type { Db } from '../db/index.js';

export interface ExportBlob {
  version: 1;
  connections: ExportConnection[];
  groups: { id: string; name: string; createdAt: string }[];
  knownHosts: { host: string; port: number; fingerprint: string; approvedAt: string }[];
  history: { connectionId: string; attemptedAt: string; status: string; errorCode: string | null; durationSec: number | null }[];
}

interface ExportConnection {
  alias: string;
  groupName: string | null;
  host: string;
  port: number;
  username: string;
  authType: 'password' | 'key';
  keyPath: string | null;
  jumpHostAlias: string | null;
  forwards: { forwardType: 'local' | 'remote'; bindAddress: string; bindPort: number; remoteHost: string; remotePort: number }[];
}

export function exportAll(db: Db): ExportBlob {
  const groups = db.listSshGroups();
  const groupById = new Map(groups.map((g) => [g.id, g]));
  const connections = db.listSshConnections();
  const connById = new Map(connections.map((c) => [c.id, c]));

  const expConns: ExportConnection[] = connections.map((c) => ({
    alias: c.alias,
    groupName: c.groupId ? (groupById.get(c.groupId)?.name ?? null) : null,
    host: c.host, port: c.port, username: c.username,
    authType: c.authType,
    keyPath: c.keyPath,
    jumpHostAlias: c.jumpHostId ? (connById.get(c.jumpHostId)?.alias ?? null) : null,
    forwards: c.forwards.map((f) => ({
      forwardType: f.forwardType, bindAddress: f.bindAddress, bindPort: f.bindPort,
      remoteHost: f.remoteHost, remotePort: f.remotePort,
    })),
  }));

  return {
    version: 1,
    connections: expConns,
    groups: groups.map((g) => ({ id: g.id, name: g.name, createdAt: g.createdAt })),
    knownHosts: db.listSshHostKeys(),
    history: db.listSshHistory(500).map((h) => ({
      connectionId: h.connectionId, attemptedAt: h.attemptedAt,
      status: h.status, errorCode: h.errorCode, durationSec: h.durationSec,
    })),
  };
}

export interface ImportReport { created: number; updated: number; skipped: number }

export function importAll(db: Db, blob: ExportBlob, strategy: 'skip' | 'update'): ImportReport {
  const report = { created: 0, updated: 0, skipped: 0 };

  // Groups by name
  const existingGroups = new Map(db.listSshGroups().map((g) => [g.name, g]));
  for (const g of blob.groups) {
    if (existingGroups.has(g.name)) continue;
    existingGroups.set(g.name, db.createSshGroup(g.name));
  }

  // Connections by alias (two passes: first create without jump host, then wire jump host)
  const existingByAlias = new Map(db.listSshConnections().map((c) => [c.alias, c]));

  // Pass 1: insert / update without jump host
  const createdByAlias = new Map<string, string>();
  for (const c of blob.connections) {
    const groupId = c.groupName ? (existingGroups.get(c.groupName)?.id ?? null) : null;
    if (existingByAlias.has(c.alias)) {
      if (strategy === 'skip') { report.skipped += 1; continue; }
      const id = existingByAlias.get(c.alias)!.id;
      db.updateSshConnection(id, {
        groupId, host: c.host, port: c.port, username: c.username,
        authType: c.authType, keyPath: c.keyPath, jumpHostId: null,
        forwards: c.forwards,
      });
      createdByAlias.set(c.alias, id);
      report.updated += 1;
    } else {
      const fresh = db.createSshConnection({
        alias: c.alias, groupId, host: c.host, port: c.port, username: c.username,
        authType: c.authType, keyPath: c.keyPath,
        passwordCipher: null, hasPassphrase: false, passphraseCipher: null,
        jumpHostId: null,
        forwards: c.forwards,
      });
      createdByAlias.set(c.alias, fresh.id);
      report.created += 1;
    }
  }

  // Pass 2: wire jump hosts
  for (const c of blob.connections) {
    if (!c.jumpHostAlias) continue;
    const selfId = createdByAlias.get(c.alias);
    const jumpId = createdByAlias.get(c.jumpHostAlias) ?? existingByAlias.get(c.jumpHostAlias)?.id;
    if (selfId && jumpId) {
      db.updateSshConnection(selfId, { jumpHostId: jumpId });
    }
  }

  // Known hosts — always add (idempotent)
  for (const k of blob.knownHosts) {
    db.approveSshHostKey(k.host, k.port, k.fingerprint);
  }

  // History — append only (no dedup — history is by nature additive)
  for (const h of blob.history) {
    db.appendSshHistory({
      connectionId: h.connectionId,
      attemptedAt: h.attemptedAt,
      status: h.status as 'connected' | 'failed',
      errorCode: h.errorCode,
      durationSec: h.durationSec,
    });
  }

  return report;
}
```

- [ ] **Step 2: Create `migration.ts`**

```typescript
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { Db } from '../db/index.js';

function sshmasterPath(): string {
  return path.join(os.homedir(), '.sshmaster', 'connections.json');
}

export function detectSshmaster(): string | null {
  const p = sshmasterPath();
  try {
    fs.accessSync(p, fs.constants.R_OK);
    return p;
  } catch {
    return null;
  }
}

export function importSshmaster(db: Db): { created: number; updated: number; skipped: number } {
  const p = detectSshmaster();
  if (!p) return { created: 0, updated: 0, skipped: 0 };
  const raw = JSON.parse(fs.readFileSync(p, 'utf8'));

  // sshmaster schema:
  //   connections: [{ id, name, host, port, username, auth: { type, keyPath?, password? }, forwards, jumpHost: { connectionId? }, groupId, lastConnectedAt }]
  //   groups: [{ id, name }]
  //   knownHosts: [{ host, port, fingerprint }]
  //   history: [{ connectionId, at, durationSec }]

  const report = { created: 0, updated: 0, skipped: 0 };

  // Groups
  const groupNameById = new Map<string, string>();
  const existingGroups = new Map(db.listSshGroups().map((g) => [g.name, g.id]));
  for (const g of (raw.groups ?? [])) {
    groupNameById.set(g.id, g.name);
    if (!existingGroups.has(g.name)) {
      const created = db.createSshGroup(g.name);
      existingGroups.set(g.name, created.id);
    }
  }

  // Connections — two passes for jump hosts
  const existingByAlias = new Map(db.listSshConnections().map((c) => [c.alias, c.id]));
  const smIdToNewId = new Map<string, string>();
  for (const c of (raw.connections ?? [])) {
    const alias: string = c.name || `conn-${c.id}`;
    if (existingByAlias.has(alias)) { report.skipped += 1; smIdToNewId.set(c.id, existingByAlias.get(alias)!); continue; }

    const groupId = c.groupId ? existingGroups.get(groupNameById.get(c.groupId) ?? '') ?? null : null;
    const forwards = (c.forwards ?? []).map((f: any) => ({
      forwardType: f.type as 'local' | 'remote',
      bindAddress: f.bindAddress ?? '127.0.0.1',
      bindPort: f.bindPort,
      remoteHost: f.remoteHost,
      remotePort: f.remotePort,
    }));

    const fresh = db.createSshConnection({
      alias,
      groupId,
      host: c.host, port: c.port ?? 22, username: c.username,
      authType: c.auth?.type === 'password' ? 'password' : 'key',
      keyPath: c.auth?.keyPath ?? null,
      passwordCipher: null,  // passwords not migrated (security)
      hasPassphrase: false, passphraseCipher: null,
      jumpHostId: null,
      forwards,
    });
    smIdToNewId.set(c.id, fresh.id);
    report.created += 1;
  }
  // Pass 2: jump hosts
  for (const c of (raw.connections ?? [])) {
    const newId = smIdToNewId.get(c.id);
    if (!newId) continue;
    const jump = c.jumpHost?.connectionId ? smIdToNewId.get(c.jumpHost.connectionId) : null;
    if (jump) db.updateSshConnection(newId, { jumpHostId: jump });
  }

  // Known hosts
  for (const k of (raw.knownHosts ?? [])) {
    db.approveSshHostKey(k.host, k.port, k.fingerprint);
  }
  // History: append what's there, map IDs if known
  for (const h of (raw.history ?? [])) {
    const cid = smIdToNewId.get(h.connectionId);
    if (!cid) continue;
    db.appendSshHistory({
      connectionId: cid,
      attemptedAt: h.at,
      status: 'connected',
      errorCode: null,
      durationSec: h.durationSec ?? null,
    });
  }

  return report;
}
```

- [ ] **Step 3: Verify**

Run `npm run check:server`. Expected: exits 0.

- [ ] **Step 4: Commit**

```bash
git add server-ts/src/ssh/importExport.ts server-ts/src/ssh/migration.ts
git commit -m "feat(ssh): JSON import/export + sshmaster migration"
```

---

## Task 11: SSH routes + WebSocket integration

**Files:**
- Create: `server-ts/src/ssh/index.ts`
- Create: `server-ts/src/routes/ssh.ts`
- Modify: `server-ts/src/websocket.ts`
- Modify: `server-ts/src/app.ts`

This is the biggest backend task. It wires all the SSH modules together into HTTP routes and WebSocket message handlers.

- [ ] **Step 1: Create `server-ts/src/ssh/index.ts`** (barrel + singletons)

```typescript
import type { Db } from '../db/index.js';
import { createHostKeyStore, type HostKeyStore } from './hostKeyStore.js';
import { createSshManager, type SshManager } from './sshManager.js';
import { createPtyManager, type PtyManager } from './ptyManager.js';
import { createForwardManager, type ForwardManager } from './forwardManager.js';

export interface SshModule {
  hostKeys: HostKeyStore;
  ssh: SshManager;
  pty: PtyManager;
  forwards: ForwardManager;
}

export function createSshModule(db: Db): SshModule {
  const hostKeys = createHostKeyStore(db);
  const ssh = createSshManager({ hostKeys });
  const pty = createPtyManager({ ssh });
  const forwards = createForwardManager({ ssh });
  return { hostKeys, ssh, pty, forwards };
}

export * from './types.js';
export { HostKeyPromptError, SshError } from './sshManager.js';
export { launchSystemTerminal } from './terminalLauncher.js';
export { exportAll, importAll } from './importExport.js';
export { detectSshmaster, importSshmaster } from './migration.js';
```

- [ ] **Step 2: Create `server-ts/src/routes/ssh.ts`**

```typescript
import { Router, type Request, type Response } from 'express';
import type { AppState } from '../state.js';
import { ApiError } from '../errors.js';
import {
  createSshModule, type SshModule, HostKeyPromptError, SshError,
  launchSystemTerminal, exportAll, importAll, detectSshmaster, importSshmaster,
} from '../ssh/index.js';
import { encrypt, decrypt } from '../ssh/crypto.js';

let sshModuleRef: SshModule | null = null;

export function sshRoutes(): Router {
  const router = Router();

  function mod(req: Request): SshModule {
    if (!sshModuleRef) {
      const state = req.app.locals.state as AppState;
      sshModuleRef = createSshModule(state.db);
    }
    return sshModuleRef;
  }

  // ── Groups ───────────────────────────────────────────
  router.get('/api/ssh/groups', (req, res) => {
    const state = req.app.locals.state as AppState;
    res.json({ groups: state.db.listSshGroups() });
  });
  router.post('/api/ssh/groups', (req, res) => {
    const state = req.app.locals.state as AppState;
    const name = (req.body?.name as string | undefined)?.trim();
    if (!name) throw ApiError.badRequest('name required');
    res.json({ group: state.db.createSshGroup(name) });
  });
  router.patch('/api/ssh/groups/:id', (req, res) => {
    const state = req.app.locals.state as AppState;
    const name = (req.body?.name as string | undefined)?.trim();
    if (!name) throw ApiError.badRequest('name required');
    state.db.renameSshGroup(req.params.id, name);
    res.json({ ok: true });
  });
  router.delete('/api/ssh/groups/:id', (req, res) => {
    const state = req.app.locals.state as AppState;
    state.db.deleteSshGroup(req.params.id);
    res.json({ ok: true });
  });

  // ── Connections ─────────────────────────────────────
  router.get('/api/ssh/connections', (req, res) => {
    const state = req.app.locals.state as AppState;
    res.json({ connections: state.db.listSshConnections() });
  });

  router.post('/api/ssh/connections', (req, res) => {
    const state = req.app.locals.state as AppState;
    const b = req.body as any;
    validateConnectionInput(b, state.db);
    const passwordCipher = b.password ? encrypt(b.password) : null;
    const hasPassphrase = Boolean(b.passphrase);
    const passphraseCipher = b.passphrase ? encrypt(b.passphrase) : null;
    const conn = state.db.createSshConnection({
      alias: b.alias, groupId: b.groupId ?? null,
      host: b.host, port: Number(b.port) || 22, username: b.username,
      authType: b.authType, keyPath: b.keyPath ?? null,
      passwordCipher, hasPassphrase, passphraseCipher,
      jumpHostId: b.jumpHostId ?? null,
      forwards: b.forwards ?? [],
    });
    res.json({ connection: conn });
  });

  router.patch('/api/ssh/connections/:id', (req, res) => {
    const state = req.app.locals.state as AppState;
    const b = req.body as any;
    const patch: any = {};
    if ('alias' in b) patch.alias = b.alias;
    if ('groupId' in b) patch.groupId = b.groupId;
    if ('host' in b) patch.host = b.host;
    if ('port' in b) patch.port = Number(b.port) || 22;
    if ('username' in b) patch.username = b.username;
    if ('authType' in b) patch.authType = b.authType;
    if ('keyPath' in b) patch.keyPath = b.keyPath;
    if ('jumpHostId' in b) patch.jumpHostId = b.jumpHostId;
    if ('forwards' in b) patch.forwards = b.forwards;
    if (b.password !== undefined) patch.passwordCipher = b.password ? encrypt(b.password) : null;
    if (b.passphrase !== undefined) {
      patch.hasPassphrase = Boolean(b.passphrase);
      patch.passphraseCipher = b.passphrase ? encrypt(b.passphrase) : null;
    }
    validateJumpHost(req.params.id, patch.jumpHostId, state.db);
    const conn = state.db.updateSshConnection(req.params.id, patch);
    res.json({ connection: conn });
  });

  router.delete('/api/ssh/connections/:id', (req, res) => {
    const state = req.app.locals.state as AppState;
    state.db.deleteSshConnection(req.params.id);
    res.json({ ok: true });
  });

  function validateConnectionInput(b: any, db: AppState['db']): void {
    if (!b?.alias) throw ApiError.badRequest('alias required');
    if (!b?.host) throw ApiError.badRequest('host required');
    if (!b?.username) throw ApiError.badRequest('username required');
    const port = Number(b.port);
    if (!Number.isFinite(port) || port < 1 || port > 65535) throw ApiError.badRequest('port out of range');
    if (b.authType !== 'password' && b.authType !== 'key') throw ApiError.badRequest('invalid authType');
    validateJumpHost(null, b.jumpHostId ?? null, db);
  }

  function validateJumpHost(selfId: string | null, jumpHostId: string | null | undefined, db: AppState['db']): void {
    if (!jumpHostId) return;
    if (selfId && jumpHostId === selfId) throw ApiError.badRequest('connection cannot be its own jump host');
    const jump = db.getSshConnection(jumpHostId);
    if (!jump) throw ApiError.badRequest('jump host not found');
    if (jump.jumpHostId) throw ApiError.badRequest('multi-level jump hosts not supported');
  }

  // ── Sessions ────────────────────────────────────────
  router.post('/api/ssh/connections/:id/connect', async (req, res) => {
    const state = req.app.locals.state as AppState;
    const m = mod(req);
    const conn = state.db.getSshConnection(req.params.id);
    if (!conn) throw ApiError.notFound('connection not found');

    const ciphers = state.db.getSshConnectionCiphers(conn.id);
    const password = ciphers.password_cipher ? decrypt(ciphers.password_cipher) ?? undefined : undefined;
    const passphrase = ciphers.passphrase_cipher ? decrypt(ciphers.passphrase_cipher) ?? undefined : undefined;

    let jumpHost: typeof conn | undefined;
    let jumpSecrets: any = undefined;
    if (conn.jumpHostId) {
      const jh = state.db.getSshConnection(conn.jumpHostId);
      if (!jh) throw ApiError.badRequest('jump host missing');
      jumpHost = jh;
      const jc = state.db.getSshConnectionCiphers(jh.id);
      jumpSecrets = {
        password: jc.password_cipher ? decrypt(jc.password_cipher) ?? undefined : undefined,
        passphrase: jc.passphrase_cipher ? decrypt(jc.passphrase_cipher) ?? undefined : undefined,
      };
    }

    const startedAt = new Date();
    try {
      const { sessionId } = await m.ssh.connect({ conn, password, passphrase, jumpHost, jumpHostSecrets: jumpSecrets });
      state.db.setSshConnectionLastConnected(conn.id, startedAt.toISOString());
      state.db.appendSshHistory({ connectionId: conn.id, attemptedAt: startedAt.toISOString(), status: 'connected', errorCode: null, durationSec: null });
      // Activate configured forwards
      for (const f of conn.forwards) {
        try { await m.forwards.activate(sessionId, f); }
        catch (e: any) { m.forwards.recordError(sessionId, f.id, e.message); }
      }
      res.json({ sessionId });
    } catch (e: any) {
      state.db.appendSshHistory({ connectionId: conn.id, attemptedAt: startedAt.toISOString(), status: 'failed', errorCode: e.code ?? 'UNKNOWN', durationSec: null });
      if (e instanceof HostKeyPromptError) {
        return res.status(409).json({
          error: 'HOST_KEY_PROMPT', host: e.host, port: e.port,
          fingerprint: e.fingerprint, kind: e.kind, expected: e.expected,
        });
      }
      if (e instanceof SshError) {
        return res.status(400).json({ error: e.code, message: e.message });
      }
      throw e;
    }
  });

  router.delete('/api/ssh/sessions/:sessionId', async (req, res) => {
    const m = mod(req);
    await m.forwards.deactivateAll(req.params.sessionId);
    m.pty.closeAllForSession(req.params.sessionId);
    await m.ssh.disconnect(req.params.sessionId);
    res.json({ ok: true });
  });

  router.get('/api/ssh/sessions', (req, res) => {
    const m = mod(req);
    const sessions = m.ssh.list().map((s) => ({
      ...s,
      ptys: m.pty.listForSession(s.sessionId).map((p) => p.ptyId),
    }));
    res.json({ sessions });
  });

  router.post('/api/ssh/sessions/:sessionId/pty', async (req, res) => {
    const m = mod(req);
    const cols = Number(req.body?.cols) || 80;
    const rows = Number(req.body?.rows) || 24;
    const { ptyId } = await m.pty.openShell(req.params.sessionId, { cols, rows });
    res.json({ ptyId });
  });

  router.delete('/api/ssh/ptys/:ptyId', (req, res) => {
    const m = mod(req);
    m.pty.close(req.params.ptyId);
    res.json({ ok: true });
  });

  router.get('/api/ssh/sessions/:sessionId/forwards', (req, res) => {
    const m = mod(req);
    res.json({ status: m.forwards.status(req.params.sessionId) });
  });

  router.post('/api/ssh/connections/:id/launch-terminal', (req, res) => {
    const state = req.app.locals.state as AppState;
    const conn = state.db.getSshConnection(req.params.id);
    if (!conn) throw ApiError.notFound('connection not found');
    const jump = conn.jumpHostId ? state.db.getSshConnection(conn.jumpHostId) : null;
    try {
      launchSystemTerminal(conn, jump);
      res.json({ ok: true });
    } catch (e: any) {
      res.status(500).json({ error: e.code ?? 'LAUNCH_FAILED', message: e.message });
    }
  });

  // ── Known hosts ─────────────────────────────────────
  router.get('/api/ssh/known-hosts', (req, res) => {
    const m = mod(req);
    res.json({ hosts: m.hostKeys.list() });
  });

  router.post('/api/ssh/known-hosts', (req, res) => {
    const m = mod(req);
    const { host, port, fingerprint } = req.body ?? {};
    if (!host || !port || !fingerprint) throw ApiError.badRequest('host, port, fingerprint required');
    m.hostKeys.approve(host, Number(port), fingerprint);
    res.json({ ok: true });
  });

  router.delete('/api/ssh/known-hosts/:host/:port', (req, res) => {
    const m = mod(req);
    m.hostKeys.delete(req.params.host, Number(req.params.port));
    res.json({ ok: true });
  });

  // ── History ─────────────────────────────────────────
  router.get('/api/ssh/history', (req, res) => {
    const state = req.app.locals.state as AppState;
    const limit = Math.min(Number(req.query.limit) || 50, 500);
    res.json({ history: state.db.listSshHistory(limit) });
  });

  // ── Import / export ────────────────────────────────
  router.get('/api/ssh/export', (req, res) => {
    const state = req.app.locals.state as AppState;
    res.json(exportAll(state.db));
  });
  router.post('/api/ssh/import', (req, res) => {
    const state = req.app.locals.state as AppState;
    const strategy = (req.query.strategy === 'update' ? 'update' : 'skip');
    const report = importAll(state.db, req.body, strategy);
    res.json(report);
  });

  // ── Sshmaster migration ────────────────────────────
  router.get('/api/ssh/migration/sshmaster', (req, res) => {
    const state = req.app.locals.state as AppState;
    const dismissed = state.db.getSshKv('sshmaster_migration_dismissed') === '1';
    const path = detectSshmaster();
    res.json({ available: Boolean(path) && !dismissed, path });
  });
  router.post('/api/ssh/migration/sshmaster', (req, res) => {
    const state = req.app.locals.state as AppState;
    const report = importSshmaster(state.db);
    state.db.setSshKv('sshmaster_migration_dismissed', '1');
    res.json(report);
  });
  router.post('/api/ssh/migration/sshmaster/dismiss', (req, res) => {
    const state = req.app.locals.state as AppState;
    state.db.setSshKv('sshmaster_migration_dismissed', '1');
    res.json({ ok: true });
  });

  return router;
}

export function getSshModule(state: AppState): SshModule {
  if (!sshModuleRef) sshModuleRef = createSshModule(state.db);
  return sshModuleRef;
}
```

- [ ] **Step 3: Wire router into `server-ts/src/app.ts`**

Find where other routers are mounted. Add:

```typescript
import { sshRoutes } from './routes/ssh.js';
// ...
app.use(sshRoutes());
```

- [ ] **Step 4: Wire WebSocket for `ssh:pty.*` in `server-ts/src/websocket.ts`**

Read the current `websocket.ts` to understand how it dispatches typed messages. Then extend it:

```typescript
// near the top
import { getSshModule } from './routes/ssh.js';

// inside the message handler (look for the switch/if chain dispatching by `type`):
if (msg.type === 'ssh:pty.subscribe') {
  const module = getSshModule(state);
  const unsubscribe = module.pty.subscribe(
    msg.ptyId,
    (data) => send({ type: 'ssh:pty.data', ptyId: msg.ptyId, data }),
    () => send({ type: 'ssh:pty.close', ptyId: msg.ptyId }),
  );
  // Track unsubscribers on the ws connection so closing the WS cleans up.
  (ws as any).__sshUnsubs ??= [];
  (ws as any).__sshUnsubs.push(unsubscribe);
  return;
}

if (msg.type === 'ssh:pty.write') {
  getSshModule(state).pty.write(msg.ptyId, msg.data);
  return;
}

if (msg.type === 'ssh:pty.resize') {
  getSshModule(state).pty.resize(msg.ptyId, msg.cols, msg.rows);
  return;
}
```

And on WS close, call all unsubscribers:

```typescript
ws.on('close', () => {
  const unsubs = (ws as any).__sshUnsubs as Array<() => void> | undefined;
  if (unsubs) for (const u of unsubs) try { u(); } catch {}
});
```

The exact integration shape depends on the existing file — open it first, follow the existing pattern, and slot the SSH handlers in beside other `type`-dispatched messages.

- [ ] **Step 5: Verify**

Run `npm run check:server`. Expected: exits 0.

- [ ] **Step 6: Install ssh2 runtime dep**

```bash
cd server-ts && npm install ssh2 @types/ssh2 && cd ..
```

Confirm `server-ts/package.json` has both.

- [ ] **Step 7: Verify**

Run `npm run check:server` again. Expected: exits 0.

- [ ] **Step 8: Commit**

```bash
git add server-ts/src/ssh/index.ts server-ts/src/routes/ssh.ts server-ts/src/app.ts server-ts/src/websocket.ts server-ts/package.json server-ts/package-lock.json
git commit -m "feat(ssh): HTTP routes + WebSocket PTY streaming"
```

---

## Task 12: Install frontend deps + frontend types

**Files:**
- Modify: `web/package.json`
- Modify: `web/src/types.ts`

- [ ] **Step 1: Install xterm and fit addon**

```bash
cd web && npm install xterm xterm-addon-fit && cd ..
```

- [ ] **Step 2: Add SSH types to `web/src/types.ts`**

Append to the file:

```typescript
export type AuthType = 'password' | 'key';
export type ForwardType = 'local' | 'remote';

export interface SshGroup {
  id: string;
  name: string;
  createdAt: string;
}

export interface SshForward {
  id: string;
  connectionId: string;
  forwardType: ForwardType;
  bindAddress: string;
  bindPort: number;
  remoteHost: string;
  remotePort: number;
  createdAt: string;
}

export interface SshConnection {
  id: string;
  alias: string;
  groupId: string | null;
  host: string;
  port: number;
  username: string;
  authType: AuthType;
  keyPath: string | null;
  hasPassword: boolean;
  hasPassphrase: boolean;
  jumpHostId: string | null;
  forwards: SshForward[];
  lastConnectedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SshHostKey {
  host: string;
  port: number;
  fingerprint: string;
  approvedAt: string;
}

export interface SshHistoryEntry {
  id: string;
  connectionId: string;
  attemptedAt: string;
  status: 'connected' | 'failed';
  errorCode: string | null;
  durationSec: number | null;
}

export interface SshSessionInfo {
  sessionId: string;
  connectionId: string;
  connectedAt: string;
  ptys: string[];
}

export interface SshForwardStatus {
  forwardId: string;
  state: 'active' | 'error';
  message?: string;
}

export interface HostKeyPromptPayload {
  host: string;
  port: number;
  fingerprint: string;
  kind: 'unknown' | 'mismatch';
  expected?: string;
}
```

- [ ] **Step 3: Verify**

Run `npm run build`. Expected: exits 0.

- [ ] **Step 4: Commit**

```bash
git add web/package.json web/package-lock.json web/src/types.ts
git commit -m "feat(web): add xterm deps and SSH types"
```

---

## Task 13: Hooks — useSshConnections

**Files:**
- Create: `web/src/hooks/useSshConnections.ts`

- [ ] **Step 1: Create the file**

```typescript
import { useCallback, useEffect, useState } from "react";
import { api } from "../api";
import type { SshConnection, SshGroup, SshForward } from "../types";

export interface CreateConnectionInput {
  alias: string;
  groupId: string | null;
  host: string;
  port: number;
  username: string;
  authType: 'password' | 'key';
  keyPath: string | null;
  password?: string;
  passphrase?: string;
  jumpHostId: string | null;
  forwards: Omit<SshForward, 'id' | 'connectionId' | 'createdAt'>[];
}

export function useSshConnections(opts: { setError: (msg: string) => void }) {
  const [connections, setConnections] = useState<SshConnection[]>([]);
  const [groups, setGroups] = useState<SshGroup[]>([]);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [c, g] = await Promise.all([
        api<{ connections: SshConnection[] }>('/api/ssh/connections'),
        api<{ groups: SshGroup[] }>('/api/ssh/groups'),
      ]);
      setConnections(c.connections ?? []);
      setGroups(g.groups ?? []);
    } catch (e) {
      opts.setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [opts]);

  useEffect(() => { void refresh(); }, [refresh]);

  const create = useCallback(async (input: CreateConnectionInput): Promise<SshConnection> => {
    const res = await api<{ connection: SshConnection }>('/api/ssh/connections', {
      method: 'POST', body: JSON.stringify(input),
    });
    await refresh();
    return res.connection;
  }, [refresh]);

  const update = useCallback(async (id: string, patch: Partial<CreateConnectionInput>): Promise<SshConnection> => {
    const res = await api<{ connection: SshConnection }>(`/api/ssh/connections/${encodeURIComponent(id)}`, {
      method: 'PATCH', body: JSON.stringify(patch),
    });
    await refresh();
    return res.connection;
  }, [refresh]);

  const remove = useCallback(async (id: string) => {
    await api(`/api/ssh/connections/${encodeURIComponent(id)}`, { method: 'DELETE' });
    await refresh();
  }, [refresh]);

  const createGroup = useCallback(async (name: string): Promise<SshGroup> => {
    const res = await api<{ group: SshGroup }>('/api/ssh/groups', {
      method: 'POST', body: JSON.stringify({ name }),
    });
    await refresh();
    return res.group;
  }, [refresh]);

  const renameGroup = useCallback(async (id: string, name: string) => {
    await api(`/api/ssh/groups/${encodeURIComponent(id)}`, {
      method: 'PATCH', body: JSON.stringify({ name }),
    });
    await refresh();
  }, [refresh]);

  const deleteGroup = useCallback(async (id: string) => {
    await api(`/api/ssh/groups/${encodeURIComponent(id)}`, { method: 'DELETE' });
    await refresh();
  }, [refresh]);

  return { connections, groups, loading, refresh, create, update, remove, createGroup, renameGroup, deleteGroup };
}

export type UseSshConnections = ReturnType<typeof useSshConnections>;
```

- [ ] **Step 2: Verify**

Run `npm run build`. Expected: exits 0.

- [ ] **Step 3: Commit**

```bash
git add web/src/hooks/useSshConnections.ts
git commit -m "feat(web): useSshConnections hook"
```

---

## Task 14: Hooks — useSshSessions and useSshPty

**Files:**
- Create: `web/src/hooks/useSshSessions.ts`
- Create: `web/src/hooks/useSshPty.ts`

- [ ] **Step 1: Create `useSshSessions.ts`**

```typescript
import { useCallback, useEffect, useState } from "react";
import { api } from "../api";
import type { SshSessionInfo, SshForwardStatus, HostKeyPromptPayload } from "../types";

export interface ConnectResult {
  ok: true;
  sessionId: string;
} | {
  ok: false;
  hostKeyPrompt?: HostKeyPromptPayload;
  errorCode?: string;
  message?: string;
}

export function useSshSessions(opts: { setError: (msg: string) => void }) {
  const [sessions, setSessions] = useState<SshSessionInfo[]>([]);

  const refresh = useCallback(async () => {
    try {
      const res = await api<{ sessions: SshSessionInfo[] }>('/api/ssh/sessions');
      setSessions(res.sessions ?? []);
    } catch (e) { opts.setError((e as Error).message); }
  }, [opts]);

  useEffect(() => { void refresh(); const t = setInterval(refresh, 5000); return () => clearInterval(t); }, [refresh]);

  const connect = useCallback(async (connectionId: string): Promise<ConnectResult> => {
    try {
      const res = await fetch(`/api/ssh/connections/${encodeURIComponent(connectionId)}/connect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      if (res.status === 409) {
        const body = await res.json();
        return { ok: false, hostKeyPrompt: { host: body.host, port: body.port, fingerprint: body.fingerprint, kind: body.kind, expected: body.expected } };
      }
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        return { ok: false, errorCode: body.error ?? 'UNKNOWN', message: body.message ?? res.statusText };
      }
      const body = await res.json();
      await refresh();
      return { ok: true, sessionId: body.sessionId };
    } catch (e) {
      return { ok: false, errorCode: 'NETWORK', message: (e as Error).message };
    }
  }, [refresh]);

  const approveHostKey = useCallback(async (host: string, port: number, fingerprint: string) => {
    await api('/api/ssh/known-hosts', {
      method: 'POST', body: JSON.stringify({ host, port, fingerprint }),
    });
  }, []);

  const disconnect = useCallback(async (sessionId: string) => {
    await api(`/api/ssh/sessions/${encodeURIComponent(sessionId)}`, { method: 'DELETE' });
    await refresh();
  }, [refresh]);

  const launchSystemTerminal = useCallback(async (connectionId: string) => {
    await api(`/api/ssh/connections/${encodeURIComponent(connectionId)}/launch-terminal`, {
      method: 'POST',
    });
  }, []);

  const getForwardStatus = useCallback(async (sessionId: string): Promise<SshForwardStatus[]> => {
    const res = await api<{ status: SshForwardStatus[] }>(`/api/ssh/sessions/${encodeURIComponent(sessionId)}/forwards`);
    return res.status ?? [];
  }, []);

  const liveCount = sessions.length;

  return { sessions, liveCount, refresh, connect, approveHostKey, disconnect, launchSystemTerminal, getForwardStatus };
}

export type UseSshSessions = ReturnType<typeof useSshSessions>;
```

- [ ] **Step 2: Create `useSshPty.ts`**

```typescript
import { useCallback } from "react";
import { api } from "../api";

export function useSshPty() {
  const openPty = useCallback(async (sessionId: string, cols: number, rows: number): Promise<string> => {
    const res = await api<{ ptyId: string }>(`/api/ssh/sessions/${encodeURIComponent(sessionId)}/pty`, {
      method: 'POST', body: JSON.stringify({ cols, rows }),
    });
    return res.ptyId;
  }, []);

  const closePty = useCallback(async (ptyId: string) => {
    await api(`/api/ssh/ptys/${encodeURIComponent(ptyId)}`, { method: 'DELETE' });
  }, []);

  return { openPty, closePty };
}

export type UseSshPty = ReturnType<typeof useSshPty>;
```

- [ ] **Step 3: Verify**

Run `npm run build`. Expected: exits 0.

- [ ] **Step 4: Commit**

```bash
git add web/src/hooks/useSshSessions.ts web/src/hooks/useSshPty.ts
git commit -m "feat(web): useSshSessions + useSshPty hooks"
```

---

## Task 15: Hook — useSshMigration

**Files:**
- Create: `web/src/hooks/useSshMigration.ts`

- [ ] **Step 1: Create the file**

```typescript
import { useCallback, useEffect, useState } from "react";
import { api } from "../api";

export function useSshMigration() {
  const [available, setAvailable] = useState(false);
  const [sourcePath, setSourcePath] = useState<string | null>(null);

  const check = useCallback(async () => {
    try {
      const res = await api<{ available: boolean; path: string | null }>('/api/ssh/migration/sshmaster');
      setAvailable(res.available);
      setSourcePath(res.path);
    } catch { /* silent */ }
  }, []);

  useEffect(() => { void check(); }, [check]);

  const runImport = useCallback(async (): Promise<{ created: number; updated: number; skipped: number }> => {
    const res = await api<{ created: number; updated: number; skipped: number }>('/api/ssh/migration/sshmaster', {
      method: 'POST',
    });
    setAvailable(false);
    return res;
  }, []);

  const dismiss = useCallback(async () => {
    await api('/api/ssh/migration/sshmaster/dismiss', { method: 'POST' });
    setAvailable(false);
  }, []);

  return { available, sourcePath, runImport, dismiss };
}

export type UseSshMigration = ReturnType<typeof useSshMigration>;
```

- [ ] **Step 2: Verify**

Run `npm run build`. Expected: exits 0.

- [ ] **Step 3: Commit**

```bash
git add web/src/hooks/useSshMigration.ts
git commit -m "feat(web): useSshMigration hook"
```

---

## Task 16: Terminal component (xterm + WebSocket)

**Files:**
- Create: `web/src/components/ssh/Terminal.tsx`

- [ ] **Step 1: Create the file**

```typescript
import { useEffect, useRef } from "react";
import { Terminal as Xterm } from "xterm";
import { FitAddon } from "xterm-addon-fit";
import "xterm/css/xterm.css";
import { useSshPty } from "../../hooks/useSshPty";

// Minimal singleton WebSocket accessor — the app already has a WebSocket;
// we assume a global getter or re-use by importing the existing `websocket.ts` client helper.
// If the existing client WS is kept on window (per current `useEventStream` pattern), use that.
declare global {
  interface Window {
    __appWs?: WebSocket;
  }
}

function sendWs(msg: object): void {
  const ws = window.__appWs;
  if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
}

export function Terminal({
  ptyId,
  active,
  onClose,
}: {
  ptyId: string;
  active: boolean;
  onClose: () => void;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const termRef = useRef<Xterm | null>(null);
  const fitRef = useRef<FitAddon | null>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const term = new Xterm({
      fontFamily: 'Menlo, Consolas, "Courier New", monospace',
      fontSize: 13,
      theme: { background: '#0b0f14', foreground: '#e6e6e6' },
      cursorBlink: true,
      scrollback: 10_000,
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(el);
    fit.fit();

    term.onData((data) => { sendWs({ type: 'ssh:pty.write', ptyId, data }); });

    // Message handler for this pty
    const onMessage = (ev: MessageEvent) => {
      try {
        const msg = JSON.parse(ev.data);
        if (msg.type === 'ssh:pty.data' && msg.ptyId === ptyId) {
          term.write(msg.data);
        } else if (msg.type === 'ssh:pty.close' && msg.ptyId === ptyId) {
          onClose();
        }
      } catch { /* ignore non-json frames */ }
    };
    const ws = window.__appWs;
    ws?.addEventListener('message', onMessage);

    // Subscribe (server replays scrollback then streams live)
    const trySubscribe = () => {
      if (ws && ws.readyState === WebSocket.OPEN) {
        sendWs({ type: 'ssh:pty.subscribe', ptyId });
      } else if (ws) {
        ws.addEventListener('open', () => sendWs({ type: 'ssh:pty.subscribe', ptyId }), { once: true });
      }
    };
    trySubscribe();

    // Resize observer
    const ro = new ResizeObserver(() => {
      try {
        fit.fit();
        const { cols, rows } = term;
        sendWs({ type: 'ssh:pty.resize', ptyId, cols, rows });
      } catch { /* ignore */ }
    });
    ro.observe(el);

    termRef.current = term;
    fitRef.current = fit;

    return () => {
      ro.disconnect();
      ws?.removeEventListener('message', onMessage);
      term.dispose();
      termRef.current = null;
    };
  }, [ptyId, onClose]);

  // Show / hide (keeps xterm mounted to preserve DOM state)
  return <div ref={containerRef} className={active ? "h-full w-full" : "hidden h-full w-full"} />;
}
```

**Note:** the Terminal component depends on a global `window.__appWs` pointing at the app's WebSocket. The current `web/src/hooks/useEventStream.ts` manages the WS; you may need to expose the instance on window (one-line addition in that hook) OR refactor Terminal to receive the WS via context. Pick the simpler path — exposing on window is a 3-line tweak in `useEventStream.ts`; do that if it compiles cleanly. Subagents: inspect `useEventStream.ts` and choose the lower-risk approach.

- [ ] **Step 2: Expose WS on window (if path chosen)**

Edit `web/src/hooks/useEventStream.ts`: where the `WebSocket` instance is created, assign `window.__appWs = ws;` after creation, and `delete window.__appWs;` on cleanup. Add a type declaration at the top:

```typescript
declare global {
  interface Window { __appWs?: WebSocket }
}
```

(Or move the declaration block to a shared `types.ts`.)

- [ ] **Step 3: Verify**

Run `npm run build`. Expected: exits 0.

- [ ] **Step 4: Commit**

```bash
git add web/src/components/ssh/Terminal.tsx web/src/hooks/useEventStream.ts
git commit -m "feat(web): SSH Terminal component (xterm + WS)"
```

---

## Task 17: SessionTabBar + ConnectionCard

**Files:**
- Create: `web/src/components/ssh/SessionTabBar.tsx`
- Create: `web/src/components/ssh/ConnectionCard.tsx`

- [ ] **Step 1: Create `SessionTabBar.tsx`**

```typescript
export function SessionTabBar({
  tabs,
  activeTabId,
  onSelect,
  onClose,
  onNew,
}: {
  tabs: { id: string; label: string }[];
  activeTabId: string | null;
  onSelect: (id: string) => void;
  onClose: (id: string) => void;
  onNew: () => void;
}) {
  return (
    <div className="flex items-center gap-0.5 border-b border-border-default bg-surface-100/70 px-2 py-1 backdrop-blur-md">
      {tabs.map((t) => {
        const active = t.id === activeTabId;
        return (
          <div
            key={t.id}
            className={`group flex items-center gap-1.5 rounded-t-md px-3 py-1 text-[12px] transition ${
              active
                ? "bg-surface-0 text-text-primary shadow-[inset_0_0_0_1px_var(--color-border-default)] border-b-surface-0"
                : "text-text-secondary hover:bg-surface-200"
            }`}
          >
            <button onClick={() => onSelect(t.id)} className="font-medium">{t.label}</button>
            <button
              onClick={(e) => { e.stopPropagation(); onClose(t.id); }}
              className="rounded-full px-1 text-text-muted opacity-0 transition hover:bg-surface-300 hover:text-text-primary group-hover:opacity-100"
              aria-label={`Close ${t.label}`}
            >
              ×
            </button>
          </div>
        );
      })}
      <button
        onClick={onNew}
        className="ml-1 flex h-6 w-6 items-center justify-center rounded-md text-text-muted transition hover:bg-surface-200 hover:text-text-primary"
        title="New terminal session"
      >
        +
      </button>
    </div>
  );
}
```

- [ ] **Step 2: Create `ConnectionCard.tsx`**

```typescript
import type { SshConnection } from "../../types";

export function ConnectionCard({
  conn,
  active,
  liveSessionCount,
  onSelect,
}: {
  conn: SshConnection;
  active: boolean;
  liveSessionCount: number;
  onSelect: () => void;
}) {
  const hasLive = liveSessionCount > 0;
  return (
    <button
      onClick={onSelect}
      className={`group flex w-full items-center gap-2 rounded-[var(--radius-md)] px-3 py-2 text-left transition ${
        active
          ? "bg-brand-tint text-text-primary shadow-[inset_0_0_0_1px_var(--color-brand-glow)]"
          : "text-text-secondary hover:bg-surface-200 hover:text-text-primary"
      }`}
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="truncate text-[13px] font-medium">{conn.alias}</span>
          {hasLive && (
            <span
              className="inline-block h-1.5 w-1.5 rounded-full bg-status-success"
              style={{ animation: 'ssh-pulse 1.5s ease-in-out infinite' }}
              aria-label="active session"
            />
          )}
        </div>
        <p className="truncate text-[11px] text-text-muted">
          {conn.username}@{conn.host}{conn.port !== 22 ? `:${conn.port}` : ''}
        </p>
      </div>
      {hasLive && (
        <span className="shrink-0 rounded-full bg-status-success/20 px-1.5 py-0.5 text-[10px] font-medium text-status-success">
          {liveSessionCount}
        </span>
      )}
    </button>
  );
}
```

- [ ] **Step 3: Add the pulse keyframe**

Find the Tailwind globals file (likely `web/src/styles/globals.css` or similar — check `web/src/main.tsx` imports). Append:

```css
@keyframes ssh-pulse {
  0%, 100% { opacity: 0.4; transform: scale(1); }
  50%      { opacity: 0.9; transform: scale(1.25); }
}
```

If there's no globals CSS, add it to whatever CSS file Vite loads (search for `.css` imports in `main.tsx`).

- [ ] **Step 4: Verify**

Run `npm run build`. Expected: exits 0.

- [ ] **Step 5: Commit**

```bash
git add web/src/components/ssh/SessionTabBar.tsx web/src/components/ssh/ConnectionCard.tsx web/src/styles 2>/dev/null
git commit -m "feat(web): SessionTabBar + ConnectionCard with pulsing dot"
```

---

## Task 18: ForwardsEditor + ConnectionFormModal

**Files:**
- Create: `web/src/components/ssh/ForwardsEditor.tsx`
- Create: `web/src/components/ssh/ConnectionFormModal.tsx`

- [ ] **Step 1: Create `ForwardsEditor.tsx`**

```typescript
import type { SshForward } from "../../types";

type Forward = Omit<SshForward, 'id' | 'connectionId' | 'createdAt'>;

export function ForwardsEditor({
  forwards,
  onChange,
}: {
  forwards: Forward[];
  onChange: (next: Forward[]) => void;
}) {
  const set = (i: number, patch: Partial<Forward>) =>
    onChange(forwards.map((f, j) => (j === i ? { ...f, ...patch } : f)));
  const add = () =>
    onChange([...forwards, { forwardType: 'local', bindAddress: '127.0.0.1', bindPort: 8080, remoteHost: 'localhost', remotePort: 80 }]);
  const remove = (i: number) =>
    onChange(forwards.filter((_, j) => j !== i));

  return (
    <div className="space-y-2">
      {forwards.length === 0 && (
        <p className="text-[11px] italic text-text-muted">No port forwards configured.</p>
      )}
      {forwards.map((f, i) => (
        <div key={i} className="flex items-center gap-2 rounded-[var(--radius-md)] border border-border-default bg-surface-200 px-3 py-2">
          <select
            value={f.forwardType}
            onChange={(e) => set(i, { forwardType: e.target.value as 'local' | 'remote' })}
            className="rounded bg-surface-300 px-2 py-1 text-[11px] text-text-primary"
          >
            <option value="local">Local (-L)</option>
            <option value="remote">Remote (-R)</option>
          </select>
          <input
            value={f.bindAddress}
            onChange={(e) => set(i, { bindAddress: e.target.value })}
            className="w-28 rounded bg-surface-300 px-2 py-1 text-[11px] text-text-primary"
            placeholder="127.0.0.1"
          />
          <input
            type="number" value={f.bindPort}
            onChange={(e) => set(i, { bindPort: Number(e.target.value) || 0 })}
            className="w-20 rounded bg-surface-300 px-2 py-1 text-[11px] text-text-primary"
            placeholder="port"
          />
          <span className="text-text-muted">→</span>
          <input
            value={f.remoteHost}
            onChange={(e) => set(i, { remoteHost: e.target.value })}
            className="flex-1 rounded bg-surface-300 px-2 py-1 text-[11px] text-text-primary"
            placeholder="localhost"
          />
          <input
            type="number" value={f.remotePort}
            onChange={(e) => set(i, { remotePort: Number(e.target.value) || 0 })}
            className="w-20 rounded bg-surface-300 px-2 py-1 text-[11px] text-text-primary"
            placeholder="port"
          />
          <button
            onClick={() => remove(i)}
            className="text-text-muted hover:text-status-danger"
            title="Remove"
          >
            ×
          </button>
        </div>
      ))}
      <button
        onClick={add}
        className="text-[11px] font-medium text-brand hover:text-brand/80"
      >
        + Add Forward
      </button>
    </div>
  );
}
```

- [ ] **Step 2: Create `ConnectionFormModal.tsx`**

```typescript
import { useEffect, useState } from "react";
import type { SshConnection, SshGroup, SshForward } from "../../types";
import { ForwardsEditor } from "./ForwardsEditor";
import { FolderPicker } from "../FolderPicker";
import { IconX } from "../icons";
import { inputClass, selectClass, btnPrimary, btnSecondary } from "../shared";

type Forward = Omit<SshForward, 'id' | 'connectionId' | 'createdAt'>;

export interface ConnectionFormValue {
  alias: string;
  groupId: string | null;
  host: string;
  port: number;
  username: string;
  authType: 'password' | 'key';
  keyPath: string | null;
  password: string;        // empty string means "don't change" on edit
  passphrase: string;
  jumpHostId: string | null;
  forwards: Forward[];
}

export function ConnectionFormModal({
  open,
  onClose,
  initial,
  groups,
  connections,
  onCreateGroup,
  onSave,
}: {
  open: boolean;
  onClose: () => void;
  initial: SshConnection | null;   // null for create
  groups: SshGroup[];
  connections: SshConnection[];
  onCreateGroup: (name: string) => Promise<SshGroup>;
  onSave: (value: ConnectionFormValue) => Promise<void>;
}) {
  const [v, setV] = useState<ConnectionFormValue>(() => valueFromInitial(initial));
  const [error, setError] = useState<string>("");
  const [saving, setSaving] = useState(false);

  useEffect(() => { if (open) { setV(valueFromInitial(initial)); setError(""); } }, [open, initial]);

  if (!open) return null;

  const handleSave = async () => {
    setError("");
    if (!v.alias.trim()) return setError("Alias required");
    if (!v.host.trim()) return setError("Host required");
    if (!v.username.trim()) return setError("Username required");
    if (v.port < 1 || v.port > 65535) return setError("Port out of range");
    if (v.authType === 'key' && !v.keyPath) return setError("Key path required");
    setSaving(true);
    try {
      await onSave(v);
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const handleGroupChange = async (val: string) => {
    if (val === '__new__') {
      const name = window.prompt("New group name:");
      if (!name?.trim()) return;
      const g = await onCreateGroup(name.trim());
      setV((p) => ({ ...p, groupId: g.id }));
    } else {
      setV((p) => ({ ...p, groupId: val || null }));
    }
  };

  // Available jump host candidates = connections without their own jump host (and not self)
  const jumpCandidates = connections.filter(
    (c) => !c.jumpHostId && (!initial || c.id !== initial.id),
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-6">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative flex max-h-[85vh] w-full max-w-2xl flex-col overflow-hidden rounded-[var(--radius-2xl)] border border-border-default bg-surface-100 shadow-[var(--shadow-lg)]">
        <header className="flex items-center justify-between border-b border-border-default px-6 py-4">
          <h3 className="text-[15px] font-semibold text-text-primary">
            {initial ? `Edit ${initial.alias}` : "New SSH Connection"}
          </h3>
          <button onClick={onClose} className="text-text-muted hover:text-text-primary" aria-label="Close">
            <IconX className="h-3.5 w-3.5" />
          </button>
        </header>

        <div className="flex-1 space-y-6 overflow-y-auto px-6 py-5 text-[12px]">
          {error && (
            <div className="rounded-[var(--radius-md)] border border-error-border bg-error-bg px-3 py-2 text-error-text">{error}</div>
          )}

          <section className="space-y-3">
            <h4 className="text-[10px] font-semibold uppercase tracking-[0.1em] text-text-muted">Identity</h4>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Alias *"><input className={inputClass} value={v.alias} onChange={(e) => setV((p) => ({ ...p, alias: e.target.value }))} /></Field>
              <Field label="Group">
                <select className={selectClass} value={v.groupId ?? ""} onChange={(e) => void handleGroupChange(e.target.value)}>
                  <option value="">— None —</option>
                  {groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
                  <option value="__new__">+ New group…</option>
                </select>
              </Field>
              <Field label="Host *"><input className={inputClass} value={v.host} onChange={(e) => setV((p) => ({ ...p, host: e.target.value }))} /></Field>
              <Field label="Port *"><input type="number" className={inputClass} value={v.port} onChange={(e) => setV((p) => ({ ...p, port: Number(e.target.value) || 22 }))} /></Field>
              <Field label="Username *"><input className={inputClass} value={v.username} onChange={(e) => setV((p) => ({ ...p, username: e.target.value }))} /></Field>
              <Field label="Auth type">
                <div className="flex gap-3">
                  <label className="flex items-center gap-1.5"><input type="radio" checked={v.authType === 'password'} onChange={() => setV((p) => ({ ...p, authType: 'password' }))} /> Password</label>
                  <label className="flex items-center gap-1.5"><input type="radio" checked={v.authType === 'key'} onChange={() => setV((p) => ({ ...p, authType: 'key' }))} /> Key (PEM)</label>
                </div>
              </Field>
              {v.authType === 'password' && (
                <Field label={initial ? "Password (leave blank to keep)" : "Password"}>
                  <input type="password" className={inputClass} value={v.password} onChange={(e) => setV((p) => ({ ...p, password: e.target.value }))} />
                </Field>
              )}
              {v.authType === 'key' && (
                <>
                  <Field label="Key path *">
                    <FolderPicker value={v.keyPath ?? ""} onChange={(val) => setV((p) => ({ ...p, keyPath: val }))} />
                  </Field>
                  <Field label={initial ? "Passphrase (leave blank to keep)" : "Passphrase (optional)"}>
                    <input type="password" className={inputClass} value={v.passphrase} onChange={(e) => setV((p) => ({ ...p, passphrase: e.target.value }))} />
                  </Field>
                </>
              )}
            </div>
          </section>

          <section className="space-y-3">
            <h4 className="text-[10px] font-semibold uppercase tracking-[0.1em] text-text-muted">Jump host (optional)</h4>
            <Field label="Via">
              <select className={selectClass} value={v.jumpHostId ?? ""} onChange={(e) => setV((p) => ({ ...p, jumpHostId: e.target.value || null }))}>
                <option value="">— None —</option>
                {jumpCandidates.map((c) => <option key={c.id} value={c.id}>{c.alias}</option>)}
              </select>
            </Field>
          </section>

          <section className="space-y-3">
            <h4 className="text-[10px] font-semibold uppercase tracking-[0.1em] text-text-muted">Port forwards (optional)</h4>
            <ForwardsEditor forwards={v.forwards} onChange={(next) => setV((p) => ({ ...p, forwards: next }))} />
          </section>
        </div>

        <footer className="flex items-center justify-end gap-2 border-t border-border-default px-6 py-3">
          <button onClick={onClose} className={btnSecondary}>Cancel</button>
          <button onClick={() => void handleSave()} disabled={saving} className={btnPrimary}>
            {saving ? "Saving…" : initial ? "Save Changes" : "Create Connection"}
          </button>
        </footer>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[11px] text-text-muted">{label}</span>
      {children}
    </label>
  );
}

function valueFromInitial(initial: SshConnection | null): ConnectionFormValue {
  if (!initial) return {
    alias: "", groupId: null, host: "", port: 22, username: "",
    authType: 'password', keyPath: null, password: "", passphrase: "",
    jumpHostId: null, forwards: [],
  };
  return {
    alias: initial.alias,
    groupId: initial.groupId,
    host: initial.host,
    port: initial.port,
    username: initial.username,
    authType: initial.authType,
    keyPath: initial.keyPath,
    password: "",
    passphrase: "",
    jumpHostId: initial.jumpHostId,
    forwards: initial.forwards.map((f) => ({
      forwardType: f.forwardType, bindAddress: f.bindAddress,
      bindPort: f.bindPort, remoteHost: f.remoteHost, remotePort: f.remotePort,
    })),
  };
}
```

- [ ] **Step 3: Verify**

Run `npm run build`. Expected: exits 0. If `FolderPicker` import or `inputClass/selectClass/btnPrimary/btnSecondary` paths differ, resolve them (they exist — used by other modals).

- [ ] **Step 4: Commit**

```bash
git add web/src/components/ssh/ForwardsEditor.tsx web/src/components/ssh/ConnectionFormModal.tsx
git commit -m "feat(web): ConnectionFormModal with jump host + forwards editor"
```

---

## Task 19: HostKeyPromptModal + KnownHostsPanel + MigrationBanner + ImportExportMenu

**Files:**
- Create: `web/src/components/ssh/HostKeyPromptModal.tsx`
- Create: `web/src/components/ssh/KnownHostsPanel.tsx`
- Create: `web/src/components/ssh/MigrationBanner.tsx`
- Create: `web/src/components/ssh/ImportExportMenu.tsx`

- [ ] **Step 1: `HostKeyPromptModal.tsx`**

```typescript
import type { HostKeyPromptPayload } from "../../types";
import { btnPrimary, btnSecondary } from "../shared";

export function HostKeyPromptModal({
  prompt,
  onApprove,
  onCancel,
}: {
  prompt: HostKeyPromptPayload;
  onApprove: () => void;
  onCancel: () => void;
}) {
  const danger = prompt.kind === 'mismatch';
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-6">
      <div className="absolute inset-0 bg-black/60" onClick={onCancel} />
      <div className={`relative w-full max-w-md space-y-3 rounded-[var(--radius-2xl)] border bg-surface-100 p-5 ${danger ? 'border-status-danger' : 'border-border-default'}`}>
        <h3 className="text-[14px] font-semibold text-text-primary">
          {danger ? '⚠ Host key mismatch' : 'Unknown host key'}
        </h3>
        <p className="text-[12px] text-text-secondary">
          {prompt.host}:{prompt.port}
        </p>
        <div className="rounded bg-surface-200 p-3 font-mono text-[11px] text-text-secondary">
          <div>Fingerprint: {prompt.fingerprint}</div>
          {prompt.expected && <div className="mt-1 text-status-danger">Expected: {prompt.expected}</div>}
        </div>
        <p className="text-[11px] text-text-muted">
          {danger
            ? 'The host key does not match what we recorded. This could be a man-in-the-middle attack. Approve only if you know the server was rebuilt or re-keyed.'
            : 'We\'ve never connected to this host before. If you recognize the fingerprint, approve to continue.'}
        </p>
        <div className="flex justify-end gap-2">
          <button onClick={onCancel} className={btnSecondary}>Cancel</button>
          <button onClick={onApprove} className={btnPrimary}>{danger ? 'Approve (replace)' : 'Approve'}</button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: `KnownHostsPanel.tsx`**

```typescript
import { useCallback, useEffect, useState } from "react";
import { api } from "../../api";
import type { SshHostKey } from "../../types";
import { IconX } from "../icons";

export function KnownHostsPanel() {
  const [hosts, setHosts] = useState<SshHostKey[]>([]);

  const refresh = useCallback(async () => {
    const res = await api<{ hosts: SshHostKey[] }>('/api/ssh/known-hosts');
    setHosts(res.hosts ?? []);
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const remove = async (host: string, port: number) => {
    await api(`/api/ssh/known-hosts/${encodeURIComponent(host)}/${port}`, { method: 'DELETE' });
    await refresh();
  };

  return (
    <div className="space-y-2">
      {hosts.length === 0 && <p className="text-[11px] italic text-text-muted">No known hosts yet.</p>}
      {hosts.map((h) => (
        <div key={`${h.host}:${h.port}`} className="group flex items-center gap-2 rounded-[var(--radius-md)] border border-border-default bg-surface-200 px-3 py-2">
          <div className="min-w-0 flex-1">
            <p className="truncate text-[12px] text-text-primary">{h.host}:{h.port}</p>
            <p className="truncate font-mono text-[10px] text-text-muted">{h.fingerprint}</p>
          </div>
          <button onClick={() => void remove(h.host, h.port)} className="text-text-muted opacity-0 hover:text-status-danger group-hover:opacity-100" title="Delete">
            <IconX className="h-3 w-3" />
          </button>
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 3: `MigrationBanner.tsx`**

```typescript
export function MigrationBanner({
  sourcePath,
  onImport,
  onDismiss,
}: {
  sourcePath: string;
  onImport: () => void;
  onDismiss: () => void;
}) {
  return (
    <div className="m-3 flex items-center gap-3 rounded-[var(--radius-md)] border border-brand-glow bg-brand-tint px-4 py-2.5">
      <div className="flex-1 text-[12px] text-text-primary">
        Found existing SSHMaster connections at <code className="text-text-secondary">{sourcePath}</code>.
      </div>
      <button
        onClick={onImport}
        className="rounded-md bg-brand px-3 py-1 text-[11px] font-medium text-white hover:bg-brand/80"
      >
        Import
      </button>
      <button
        onClick={onDismiss}
        className="rounded-md bg-surface-200 px-3 py-1 text-[11px] font-medium text-text-secondary hover:text-text-primary"
      >
        Dismiss
      </button>
    </div>
  );
}
```

- [ ] **Step 4: `ImportExportMenu.tsx`**

```typescript
import { useRef, useState } from "react";
import { api } from "../../api";

export function ImportExportMenu({ onDone }: { onDone: () => void }) {
  const [open, setOpen] = useState(false);
  const fileInput = useRef<HTMLInputElement | null>(null);

  const handleExport = async () => {
    const blob = await fetch('/api/ssh/export').then((r) => r.blob());
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'ssh-export.json'; a.click();
    URL.revokeObjectURL(url);
    setOpen(false);
  };

  const handleImportFile = async (file: File, strategy: 'skip' | 'update') => {
    const text = await file.text();
    const payload = JSON.parse(text);
    await fetch(`/api/ssh/import?strategy=${strategy}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    onDone();
    setOpen(false);
  };

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="rounded-md bg-surface-200 px-2.5 py-1 text-[11px] font-medium text-text-secondary hover:bg-surface-300 hover:text-text-primary"
      >
        ⋯
      </button>
      {open && (
        <div className="absolute right-0 top-full z-20 mt-1 w-48 overflow-hidden rounded-[var(--radius-md)] border border-border-default bg-surface-100 shadow-[var(--shadow-md)]">
          <button
            onClick={() => void handleExport()}
            className="flex w-full items-center gap-2 px-3 py-2 text-left text-[11px] text-text-secondary hover:bg-surface-200 hover:text-text-primary"
          >Export JSON</button>
          <button
            onClick={() => fileInput.current?.click()}
            className="flex w-full items-center gap-2 px-3 py-2 text-left text-[11px] text-text-secondary hover:bg-surface-200 hover:text-text-primary"
          >Import (skip existing)</button>
          <input
            ref={fileInput}
            type="file"
            accept="application/json"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void handleImportFile(f, 'skip');
              e.target.value = '';
            }}
          />
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 5: Verify**

Run `npm run build`. Expected: exits 0.

- [ ] **Step 6: Commit**

```bash
git add web/src/components/ssh/HostKeyPromptModal.tsx web/src/components/ssh/KnownHostsPanel.tsx web/src/components/ssh/MigrationBanner.tsx web/src/components/ssh/ImportExportMenu.tsx
git commit -m "feat(web): host key prompt, known hosts, migration banner, import/export"
```

---

## Task 20: ConnectionList + ConnectionDetail

**Files:**
- Create: `web/src/components/ssh/ConnectionList.tsx`
- Create: `web/src/components/ssh/ConnectionDetail.tsx`

- [ ] **Step 1: `ConnectionList.tsx`**

```typescript
import { useMemo, useState } from "react";
import type { SshConnection, SshGroup, SshSessionInfo } from "../../types";
import { ConnectionCard } from "./ConnectionCard";
import { ImportExportMenu } from "./ImportExportMenu";
import { btnPrimary } from "../shared";

export function ConnectionList({
  connections,
  groups,
  sessions,
  selectedId,
  onSelect,
  onNew,
  onImportExportDone,
}: {
  connections: SshConnection[];
  groups: SshGroup[];
  sessions: SshSessionInfo[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onNew: () => void;
  onImportExportDone: () => void;
}) {
  const [query, setQuery] = useState("");

  const sessionsByConn = useMemo(() => {
    const m = new Map<string, number>();
    for (const s of sessions) m.set(s.connectionId, (m.get(s.connectionId) ?? 0) + 1);
    return m;
  }, [sessions]);

  const q = query.trim().toLowerCase();
  const matches = (c: SshConnection) =>
    !q || c.alias.toLowerCase().includes(q) || c.host.toLowerCase().includes(q) || c.username.toLowerCase().includes(q);

  const ungrouped = connections.filter((c) => !c.groupId && matches(c));
  const grouped = groups
    .map((g) => ({ group: g, items: connections.filter((c) => c.groupId === g.id && matches(c)) }))
    .filter((x) => x.items.length > 0);

  return (
    <aside className="flex h-full w-[280px] shrink-0 flex-col border-r border-border-default bg-surface-0/80">
      <div className="flex items-center gap-2 border-b border-border-default px-3 py-3">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search connections…"
          className="flex-1 rounded-md border border-border-default bg-surface-200 px-2 py-1 text-[12px] text-text-primary placeholder:text-text-muted focus:border-brand focus:outline-none"
        />
        <ImportExportMenu onDone={onImportExportDone} />
      </div>
      <div className="border-b border-border-default px-3 py-2">
        <button onClick={onNew} className={`${btnPrimary} w-full text-[11px]`}>+ New Connection</button>
      </div>
      <div className="flex-1 space-y-3 overflow-y-auto p-2">
        {ungrouped.length > 0 && (
          <div className="space-y-0.5">
            {ungrouped.map((c) => (
              <ConnectionCard key={c.id} conn={c} active={c.id === selectedId} liveSessionCount={sessionsByConn.get(c.id) ?? 0} onSelect={() => onSelect(c.id)} />
            ))}
          </div>
        )}
        {grouped.map(({ group, items }) => (
          <div key={group.id} className="space-y-0.5">
            <p className="px-3 text-[10px] font-semibold uppercase tracking-[0.1em] text-text-muted">{group.name}</p>
            {items.map((c) => (
              <ConnectionCard key={c.id} conn={c} active={c.id === selectedId} liveSessionCount={sessionsByConn.get(c.id) ?? 0} onSelect={() => onSelect(c.id)} />
            ))}
          </div>
        ))}
        {ungrouped.length === 0 && grouped.length === 0 && (
          <p className="p-4 text-center text-[11px] italic text-text-muted">
            {q ? 'No matches.' : 'No connections. Click + New Connection.'}
          </p>
        )}
      </div>
    </aside>
  );
}
```

- [ ] **Step 2: `ConnectionDetail.tsx`**

```typescript
import { useCallback, useEffect, useState } from "react";
import type { SshConnection, SshSessionInfo, SshForwardStatus } from "../../types";
import { SessionTabBar } from "./SessionTabBar";
import { Terminal } from "./Terminal";
import { btnSecondary } from "../shared";
import type { UseSshPty } from "../../hooks/useSshPty";
import type { UseSshSessions } from "../../hooks/useSshSessions";

interface TabRef { id: string; label: string; ptyId: string; sessionId: string }

export function ConnectionDetail({
  conn,
  sessions,
  pty,
  sshSessions,
  onEdit,
  onDelete,
  onRequestConnect,
}: {
  conn: SshConnection;
  sessions: SshSessionInfo[];
  pty: UseSshPty;
  sshSessions: UseSshSessions;
  onEdit: () => void;
  onDelete: () => void;
  onRequestConnect: () => Promise<string | null>;  // returns sessionId or null
}) {
  const [tabs, setTabs] = useState<TabRef[]>([]);
  const [activeTabId, setActiveTabId] = useState<string | null>(null);
  const [forwardStatuses, setForwardStatuses] = useState<SshForwardStatus[]>([]);

  // When a new live session appears for this connection, re-seed tabs from server-reported ptys.
  useEffect(() => {
    const mine = sessions.filter((s) => s.connectionId === conn.id);
    const knownIds = new Set(tabs.map((t) => t.ptyId));
    const newTabs = [...tabs];
    for (const s of mine) {
      for (const ptyId of s.ptys) {
        if (!knownIds.has(ptyId)) {
          newTabs.push({ id: ptyId, label: shortId(ptyId), ptyId, sessionId: s.sessionId });
          knownIds.add(ptyId);
        }
      }
    }
    // Drop tabs whose ptyId no longer appears
    const stillLive = new Set(mine.flatMap((s) => s.ptys));
    const filtered = newTabs.filter((t) => stillLive.has(t.ptyId));
    if (filtered.length !== tabs.length || filtered.some((t, i) => t.ptyId !== tabs[i]?.ptyId)) {
      setTabs(filtered);
      if (!filtered.find((t) => t.id === activeTabId)) {
        setActiveTabId(filtered[0]?.id ?? null);
      }
    }
  }, [sessions, conn.id, tabs, activeTabId]);

  // Fetch forward status per live session
  useEffect(() => {
    const mine = sessions.filter((s) => s.connectionId === conn.id);
    if (mine.length === 0) { setForwardStatuses([]); return; }
    let cancelled = false;
    Promise.all(mine.map((s) => sshSessions.getForwardStatus(s.sessionId)))
      .then((lists) => { if (!cancelled) setForwardStatuses(lists.flat()); });
    return () => { cancelled = true; };
  }, [sessions, conn.id, sshSessions]);

  const newSession = useCallback(async () => {
    let sessionId = sessions.find((s) => s.connectionId === conn.id)?.sessionId;
    if (!sessionId) {
      sessionId = await onRequestConnect() ?? undefined;
      if (!sessionId) return;
    }
    const ptyId = await pty.openPty(sessionId, 80, 24);
    setTabs((p) => [...p, { id: ptyId, label: shortId(ptyId), ptyId, sessionId: sessionId! }]);
    setActiveTabId(ptyId);
  }, [sessions, conn.id, pty, onRequestConnect]);

  const closeTab = useCallback(async (tabId: string) => {
    const tab = tabs.find((t) => t.id === tabId);
    if (!tab) return;
    await pty.closePty(tab.ptyId);
    setTabs((p) => p.filter((t) => t.id !== tabId));
    if (activeTabId === tabId) {
      setActiveTabId(null);
    }
  }, [tabs, pty, activeTabId]);

  const launchSystemTerminal = () => { void sshSessions.launchSystemTerminal(conn.id); };
  const disconnectAll = async () => {
    const mine = sessions.filter((s) => s.connectionId === conn.id);
    for (const s of mine) { await sshSessions.disconnect(s.sessionId); }
    setTabs([]); setActiveTabId(null);
  };

  return (
    <div className="flex h-full flex-1 flex-col">
      <header className="flex items-center justify-between border-b border-border-default px-6 py-3">
        <div className="min-w-0">
          <h2 className="truncate text-[14px] font-semibold text-text-primary">{conn.alias}</h2>
          <p className="truncate text-[11px] text-text-muted">
            {conn.username}@{conn.host}{conn.port !== 22 ? `:${conn.port}` : ''}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => void newSession()} className={btnSecondary + ' text-[11px]'}>+ New Session</button>
          <button onClick={onEdit} className={btnSecondary + ' text-[11px]'}>Edit</button>
          <button
            onClick={onDelete}
            className="rounded-md bg-status-danger/10 px-2.5 py-1 text-[11px] font-medium text-status-danger hover:bg-status-danger/20"
          >Delete</button>
        </div>
      </header>

      {forwardStatuses.length > 0 && (
        <div className="border-b border-border-default px-6 py-2 text-[11px] text-text-muted">
          Forwards: {forwardStatuses.map((f) => (
            <span key={f.forwardId} className={`mr-2 ${f.state === 'error' ? 'text-status-danger' : 'text-status-success'}`}>
              ● {f.forwardId.slice(0, 6)} {f.state}{f.message ? ` — ${f.message}` : ''}
            </span>
          ))}
        </div>
      )}

      {tabs.length > 0 ? (
        <>
          <SessionTabBar
            tabs={tabs.map((t) => ({ id: t.id, label: t.label }))}
            activeTabId={activeTabId}
            onSelect={setActiveTabId}
            onClose={(id) => void closeTab(id)}
            onNew={() => void newSession()}
          />
          <div className="relative flex-1 bg-[#0b0f14]">
            {tabs.map((t) => (
              <div key={t.id} className={`absolute inset-0 ${activeTabId === t.id ? '' : 'hidden'}`}>
                <Terminal
                  ptyId={t.ptyId}
                  active={activeTabId === t.id}
                  onClose={() => void closeTab(t.id)}
                />
              </div>
            ))}
          </div>
          <footer className="flex items-center justify-end gap-2 border-t border-border-default px-6 py-2 text-[11px]">
            <button onClick={launchSystemTerminal} disabled={conn.authType === 'password'} className={btnSecondary + ' text-[11px] disabled:opacity-50'} title={conn.authType === 'password' ? 'Password auth: use embedded terminal or key-based auth' : undefined}>
              System Terminal
            </button>
            <button onClick={() => void disconnectAll()} className="rounded-md bg-status-danger/10 px-2.5 py-1 font-medium text-status-danger hover:bg-status-danger/20">
              Disconnect
            </button>
          </footer>
        </>
      ) : (
        <div className="flex flex-1 items-center justify-center">
          <button onClick={() => void newSession()} className={btnSecondary}>+ New Session</button>
        </div>
      )}
    </div>
  );
}

function shortId(id: string): string { return id.slice(0, 6); }
```

- [ ] **Step 3: Verify**

Run `npm run build`. Expected: exits 0.

- [ ] **Step 4: Commit**

```bash
git add web/src/components/ssh/ConnectionList.tsx web/src/components/ssh/ConnectionDetail.tsx
git commit -m "feat(web): SSH ConnectionList + ConnectionDetail"
```

---

## Task 21: SshView + rail REMOTE + routing + App.tsx wiring

**Files:**
- Create: `web/src/views/SshView.tsx`
- Modify: `web/src/hooks/useHashRoute.ts`
- Modify: `web/src/components/SideRail.tsx`
- Modify: `web/src/App.tsx`

- [ ] **Step 1: Add `"ssh"` to the ROUTES array in `useHashRoute.ts`**

Append `"ssh"` as the last entry:

```typescript
export const ROUTES = [
  "board", "analyst", "workflow",
  "extensions", "agents", "rules", "memories", "glossary", "repos", "data",
  "ssh",
] as const;
```

- [ ] **Step 2: Add REMOTE group to `SideRail.tsx`**

Read the current `SideRail.tsx`. Inside the component, add a new `sshLiveCount` prop to the prop type AND a new `remoteItems` array with the SSH entry:

```typescript
// Add to the props type:
sshLiveCount: number;
```

Inside the component body, after `configureItems`, add:

```typescript
const remoteItems: NavItem[] = [
  { route: "ssh", label: "SSH", icon: IconSshRail, badge: sshLiveCount > 0 ? sshLiveCount : undefined },
];
```

Render a third `NavGroup title="Remote"` between the CONFIGURE group and the footer.

Append a new local icon component at the bottom:

```typescript
function IconSshRail({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 3H5.25A2.25 2.25 0 003 5.25v13.5A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V5.25A2.25 2.25 0 0018.75 3h-3M8.25 3v3.75M15.75 3v3.75M7.5 12l2.25 2.25L7.5 16.5M12 16.5h4.5" />
    </svg>
  );
}
```

The badge already pulses visually in the existing `NavGroup` — but we want the SSH item specifically to show a pulsing dot. Extend the `NavItem` type and `NavGroup` to optionally render a pulsing dot instead of a numeric badge:

In the `NavItem` type:

```typescript
type NavItem = {
  // ...existing fields...
  pulse?: boolean;
};
```

Where `remoteItems` is defined, change to `pulse: sshLiveCount > 0`. In the `NavGroup` JSX, add:

```typescript
{item.pulse && (
  <span
    className="inline-block h-1.5 w-1.5 rounded-full bg-status-success"
    style={{ animation: 'ssh-pulse 1.5s ease-in-out infinite' }}
  />
)}
```

Place it next to the `item.badge` render.

- [ ] **Step 3: Create `web/src/views/SshView.tsx`**

```typescript
import { useState } from "react";
import type { SshConnection } from "../types";
import { ConnectionList } from "../components/ssh/ConnectionList";
import { ConnectionDetail } from "../components/ssh/ConnectionDetail";
import { ConnectionFormModal, type ConnectionFormValue } from "../components/ssh/ConnectionFormModal";
import { HostKeyPromptModal } from "../components/ssh/HostKeyPromptModal";
import { MigrationBanner } from "../components/ssh/MigrationBanner";
import type { UseSshConnections } from "../hooks/useSshConnections";
import type { UseSshSessions } from "../hooks/useSshSessions";
import type { UseSshPty } from "../hooks/useSshPty";
import type { UseSshMigration } from "../hooks/useSshMigration";

export function SshView({
  sshConnections,
  sshSessions,
  sshPty,
  migration,
  setInfo,
  setError,
}: {
  sshConnections: UseSshConnections;
  sshSessions: UseSshSessions;
  sshPty: UseSshPty;
  migration: UseSshMigration;
  setInfo: (m: string) => void;
  setError: (m: string) => void;
}) {
  const { connections, groups, create, update, remove, createGroup, refresh: refreshConnections } = sshConnections;
  const { sessions, connect, approveHostKey } = sshSessions;

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [formInitial, setFormInitial] = useState<SshConnection | null>(null);
  const [pendingHostKey, setPendingHostKey] = useState<{ connectionId: string; host: string; port: number; fingerprint: string; kind: 'unknown' | 'mismatch'; expected?: string } | null>(null);

  const selected = selectedId ? connections.find((c) => c.id === selectedId) ?? null : null;

  const openNew = () => { setFormInitial(null); setFormOpen(true); };
  const openEdit = () => { setFormInitial(selected); setFormOpen(true); };

  const handleSave = async (v: ConnectionFormValue) => {
    const body = {
      alias: v.alias, groupId: v.groupId, host: v.host, port: v.port, username: v.username,
      authType: v.authType, keyPath: v.keyPath,
      password: v.password || undefined,
      passphrase: v.passphrase || undefined,
      jumpHostId: v.jumpHostId, forwards: v.forwards,
    };
    if (formInitial) await update(formInitial.id, body);
    else {
      const c = await create(body as any);
      setSelectedId(c.id);
    }
  };

  const handleDelete = async () => {
    if (!selected) return;
    if (!window.confirm(`Delete connection "${selected.alias}"?`)) return;
    await remove(selected.id);
    setSelectedId(null);
  };

  const tryConnect = async (connectionId: string): Promise<string | null> => {
    const res = await connect(connectionId);
    if (res.ok) return res.sessionId;
    if (res.hostKeyPrompt) {
      setPendingHostKey({ connectionId, ...res.hostKeyPrompt });
      return null;
    }
    setError(res.message || res.errorCode || 'Connection failed');
    return null;
  };

  const handleHostKeyApprove = async () => {
    if (!pendingHostKey) return;
    await approveHostKey(pendingHostKey.host, pendingHostKey.port, pendingHostKey.fingerprint);
    const connId = pendingHostKey.connectionId;
    setPendingHostKey(null);
    const sessionId = await tryConnect(connId);
    if (sessionId) setInfo('Connected.');
  };

  return (
    <div className="flex h-full">
      <div className="flex flex-1 flex-col">
        {migration.available && migration.sourcePath && (
          <MigrationBanner
            sourcePath={migration.sourcePath}
            onImport={async () => {
              const r = await migration.runImport();
              setInfo(`Imported ${r.created} connections.`);
              await refreshConnections();
            }}
            onDismiss={() => void migration.dismiss()}
          />
        )}
        <div className="flex flex-1 min-h-0">
          <ConnectionList
            connections={connections}
            groups={groups}
            sessions={sessions}
            selectedId={selectedId}
            onSelect={setSelectedId}
            onNew={openNew}
            onImportExportDone={() => void refreshConnections()}
          />
          {selected ? (
            <ConnectionDetail
              conn={selected}
              sessions={sessions}
              pty={sshPty}
              sshSessions={sshSessions}
              onEdit={openEdit}
              onDelete={() => void handleDelete()}
              onRequestConnect={() => tryConnect(selected.id)}
            />
          ) : (
            <div className="flex flex-1 items-center justify-center text-[12px] text-text-muted">
              Select a connection or create a new one.
            </div>
          )}
        </div>
      </div>

      <ConnectionFormModal
        open={formOpen}
        onClose={() => setFormOpen(false)}
        initial={formInitial}
        groups={groups}
        connections={connections}
        onCreateGroup={createGroup}
        onSave={handleSave}
      />

      {pendingHostKey && (
        <HostKeyPromptModal
          prompt={{
            host: pendingHostKey.host, port: pendingHostKey.port,
            fingerprint: pendingHostKey.fingerprint, kind: pendingHostKey.kind,
            expected: pendingHostKey.expected,
          }}
          onApprove={() => void handleHostKeyApprove()}
          onCancel={() => setPendingHostKey(null)}
        />
      )}
    </div>
  );
}
```

- [ ] **Step 4: Wire into `App.tsx`**

Import the hooks and view:

```typescript
import { useSshConnections } from "./hooks/useSshConnections";
import { useSshSessions } from "./hooks/useSshSessions";
import { useSshPty } from "./hooks/useSshPty";
import { useSshMigration } from "./hooks/useSshMigration";
import { SshView } from "./views/SshView";
```

Inside the component:

```typescript
const sshConnections = useSshConnections({ setError });
const sshSessions = useSshSessions({ setError });
const sshPty = useSshPty();
const migration = useSshMigration();
```

Pass `sshLiveCount={sshSessions.liveCount}` to `<SideRail>`.

Add to the route switch inside `<main>`:

```tsx
{route === "ssh" && (
  <SshView
    sshConnections={sshConnections}
    sshSessions={sshSessions}
    sshPty={sshPty}
    migration={migration}
    setInfo={setInfo}
    setError={setError}
  />
)}
```

- [ ] **Step 5: Verify**

Run `npm run build`. Expected: exits 0.

- [ ] **Step 6: Commit**

```bash
git add web/src/views/SshView.tsx web/src/hooks/useHashRoute.ts web/src/components/SideRail.tsx web/src/App.tsx
git commit -m "feat(web): mount SshView, add REMOTE rail group, wire routing"
```

---

## Task 22: Final verification

- [ ] **Step 1: Full build**

```bash
npm run build
```

Expected: exits 0.

- [ ] **Step 2: Server typecheck**

```bash
npm run check:server
```

Expected: exits 0.

- [ ] **Step 3: Server unit tests**

```bash
cd server-ts && npx tsx --test src/ssh/crypto.test.ts && cd ..
```

Expected: all tests pass.

- [ ] **Step 4: Web lint**

```bash
cd web && npx eslint . && cd ..
```

Expected: zero new errors beyond the pre-existing `setState-in-effect` warnings from the side-rail work.

- [ ] **Step 5: Manual smoke test**

Start the dev servers (`npm run dev`) and walk through:

| Action                                                     | Expected                                                         |
|------------------------------------------------------------|------------------------------------------------------------------|
| Navigate to `#ssh` via the rail's REMOTE > SSH item        | SshView loads. Left list empty or shows existing.                |
| (If `~/.sshmaster/connections.json` exists) migration banner | Banner appears. Import runs; connections populate.             |
| Click + New Connection, fill, Save                          | Entry appears in the list.                                       |
| Select a connection, click + New Session                    | If first-time host: HostKeyPromptModal. Approve. xterm renders.  |
| Type `echo hello`                                          | Output appears in xterm.                                         |
| Click + (session tab bar) to open a second PTY              | New tab added. Both terminals independently active.              |
| Switch tabs                                                 | Each xterm preserves its scrollback.                             |
| Close a tab                                                 | PTY closes server-side. Tab removed.                             |
| Close last tab                                              | (Current impl keeps session; verify via sessions list if needed.)|
| Navigate to `#board`, then back to `#ssh`                   | Tabs re-appear with replayed scrollback.                         |
| Click System Terminal on a key-auth connection              | Native terminal opens with ssh command.                          |
| Click System Terminal on a password-auth connection         | Button disabled (tooltip explains).                              |
| Click Delete on a connection                                | Confirm prompt, then removed.                                    |
| Export JSON                                                 | Download succeeds; file has non-empty connections array.         |
| Import the same JSON                                        | Report shows skipped = N (same entries).                         |
| Rail REMOTE > SSH item                                      | Shows pulsing dot when any session is live.                      |

- [ ] **Step 6: Commit any fixes**

If smoke test reveals issues, fix and commit:

```bash
git add -A
git commit -m "fix(ssh): regression fixes from manual QA"
```

If no fixes needed, skip this step.

---

## Files Created / Modified (Summary)

**Created — Backend (12):**
- `server-ts/migrations/V14__add_ssh_tables.sql`
- `server-ts/src/ssh/types.ts`
- `server-ts/src/ssh/crypto.ts`
- `server-ts/src/ssh/crypto.test.ts`
- `server-ts/src/ssh/hostKeyStore.ts`
- `server-ts/src/ssh/sshManager.ts`
- `server-ts/src/ssh/ptyManager.ts`
- `server-ts/src/ssh/forwardManager.ts`
- `server-ts/src/ssh/terminalLauncher.ts`
- `server-ts/src/ssh/importExport.ts`
- `server-ts/src/ssh/migration.ts`
- `server-ts/src/ssh/index.ts`
- `server-ts/src/db/ssh.ts`
- `server-ts/src/routes/ssh.ts`

**Modified — Backend (3):**
- `server-ts/src/app.ts` (mount router)
- `server-ts/src/websocket.ts` (ssh:pty.* handling)
- `server-ts/package.json` (ssh2, @types/ssh2)

**Created — Frontend (16):**
- `web/src/hooks/useSshConnections.ts`
- `web/src/hooks/useSshSessions.ts`
- `web/src/hooks/useSshPty.ts`
- `web/src/hooks/useSshMigration.ts`
- `web/src/components/ssh/Terminal.tsx`
- `web/src/components/ssh/SessionTabBar.tsx`
- `web/src/components/ssh/ConnectionCard.tsx`
- `web/src/components/ssh/ForwardsEditor.tsx`
- `web/src/components/ssh/ConnectionFormModal.tsx`
- `web/src/components/ssh/HostKeyPromptModal.tsx`
- `web/src/components/ssh/KnownHostsPanel.tsx`
- `web/src/components/ssh/MigrationBanner.tsx`
- `web/src/components/ssh/ImportExportMenu.tsx`
- `web/src/components/ssh/ConnectionList.tsx`
- `web/src/components/ssh/ConnectionDetail.tsx`
- `web/src/views/SshView.tsx`

**Modified — Frontend (5):**
- `web/src/hooks/useHashRoute.ts` (add "ssh")
- `web/src/components/SideRail.tsx` (REMOTE group, pulse prop)
- `web/src/hooks/useEventStream.ts` (expose ws on window)
- `web/src/App.tsx` (hooks + route render)
- `web/src/types.ts` (SSH types)
- `web/package.json` (xterm deps)

---

## Self-Review Checklist (completed by plan author)

- **Spec coverage:** Every bullet under "Scope" in the spec maps to one or more tasks. Cross-platform: terminal launcher (Task 9), spawnSync patterns throughout, `0600` master-key file (Task 3), `wt.exe`/`cmd` fallback on Windows (Task 9). Scrollback: Task 7 ring buffer + Task 16 subscribe. Encryption: Task 3 crypto + Task 11 routes. Groups: Tasks 1, 4, 13, 20. Forwards: Tasks 8, 11, 18, 20. Jump host: Task 6 chaining + Task 11 validation + Task 18 form UI. Import/export: Tasks 10, 11, 19. Migration: Tasks 10, 11, 15, 19. Host key TOFU: Tasks 5, 6, 11, 19. History: Tasks 1, 4, 11. Indicator dot: Tasks 17, 21.
- **Placeholder scan:** No TBDs, no "implement appropriately", no unspecified code blocks. Every non-trivial module has its full contents or explicit reference to sshmaster source with the specific function names to port.
- **Type consistency:** `SshConnection` shape is defined once (Task 2) and reused by all server modules; `web/src/types.ts` (Task 12) mirrors the same fields. `SshForward`, `SshSessionInfo`, `SshHostKey`, `SshHistoryEntry`, `HostKeyPromptPayload`, `SshForwardStatus` all consistent. `ForwardType` / `AuthType` union strings match at every layer.
