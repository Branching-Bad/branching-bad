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

  const report = { created: 0, updated: 0, skipped: 0 };

  const groupNameById = new Map<string, string>();
  const existingGroups = new Map(db.listSshGroups().map((g) => [g.name, g.id]));
  for (const g of (raw.groups ?? [])) {
    groupNameById.set(g.id, g.name);
    if (!existingGroups.has(g.name)) {
      const created = db.createSshGroup(g.name);
      existingGroups.set(g.name, created.id);
    }
  }

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
      passwordCipher: null,
      hasPassphrase: false, passphraseCipher: null,
      jumpHostId: null,
      forwards,
    });
    smIdToNewId.set(c.id, fresh.id);
    report.created += 1;
  }
  for (const c of (raw.connections ?? [])) {
    const newId = smIdToNewId.get(c.id);
    if (!newId) continue;
    const jump = c.jumpHost?.connectionId ? smIdToNewId.get(c.jumpHost.connectionId) : null;
    if (jump) db.updateSshConnection(newId, { jumpHostId: jump });
  }

  for (const k of (raw.knownHosts ?? [])) {
    db.approveSshHostKey(k.host, k.port, k.fingerprint);
  }
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
