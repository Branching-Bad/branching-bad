import { Db, nowIso } from '../db/index.js';
import { v4 as uuidv4 } from 'uuid';
import type {
  SshGroup, SshConnection, SshForward, SshHostKey, SshHistoryEntry, AuthType, ForwardType,
} from '../ssh/types.js';

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

declare module '../db/index.js' {
  interface Db {
    listSshGroups(): SshGroup[];
    createSshGroup(name: string): SshGroup;
    renameSshGroup(id: string, name: string): void;
    deleteSshGroup(id: string): void;

    listSshConnections(): SshConnection[];
    getSshConnection(id: string): SshConnection | null;
    createSshConnection(input: SshConnectionInput): SshConnection;
    updateSshConnection(id: string, patch: Partial<SshConnectionInput>): SshConnection;
    deleteSshConnection(id: string): void;
    setSshConnectionLastConnected(id: string, at: string): void;

    replaceSshConnectionForwards(
      connectionId: string,
      forwards: Omit<SshForward, 'id' | 'connectionId' | 'createdAt'>[],
    ): SshForward[];

    getSshConnectionCiphers(id: string): { password_cipher: string | null; passphrase_cipher: string | null };

    listSshHostKeys(): SshHostKey[];
    findSshHostKey(host: string, port: number): SshHostKey | null;
    approveSshHostKey(host: string, port: number, fingerprint: string): void;
    deleteSshHostKey(host: string, port: number): void;

    appendSshHistory(entry: Omit<SshHistoryEntry, 'id'>): void;
    listSshHistory(limit: number): SshHistoryEntry[];

    getSshKv(key: string): string | null;
    setSshKv(key: string, value: string): void;
  }
}

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
  this.replaceSshConnectionForwards(id, input.forwards);
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
  const colMap: Record<string, string> = {
    alias: 'alias', groupId: 'group_id', host: 'host', port: 'port', username: 'username',
    authType: 'auth_type', keyPath: 'key_path', passwordCipher: 'password_cipher',
    hasPassphrase: 'has_passphrase', passphraseCipher: 'passphrase_cipher', jumpHostId: 'jump_host_id',
  };
  for (const k of Object.keys(patch)) {
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
