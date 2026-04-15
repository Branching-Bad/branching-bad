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
