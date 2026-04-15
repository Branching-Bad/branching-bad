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

  const existingGroups = new Map(db.listSshGroups().map((g) => [g.name, g]));
  for (const g of blob.groups) {
    if (existingGroups.has(g.name)) continue;
    existingGroups.set(g.name, db.createSshGroup(g.name));
  }

  const existingByAlias = new Map(db.listSshConnections().map((c) => [c.alias, c]));
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

  for (const c of blob.connections) {
    if (!c.jumpHostAlias) continue;
    const selfId = createdByAlias.get(c.alias);
    const jumpId = createdByAlias.get(c.jumpHostAlias) ?? existingByAlias.get(c.jumpHostAlias)?.id;
    if (selfId && jumpId) {
      db.updateSshConnection(selfId, { jumpHostId: jumpId });
    }
  }

  for (const k of blob.knownHosts) {
    db.approveSshHostKey(k.host, k.port, k.fingerprint);
  }

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
