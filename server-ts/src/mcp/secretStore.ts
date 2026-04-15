import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export interface SecretStore {
  set(mcpServerId: string, envKey: string, value: string): Promise<void>;
  get(mcpServerId: string, envKey: string): Promise<string | null>;
  delete(mcpServerId: string, envKey: string): Promise<void>;
  deleteAll(mcpServerId: string): Promise<void>;
}

export class FallbackSecretStore implements SecretStore {
  private readonly keyPath: string;
  private readonly storePath: string;

  constructor(dataDir: string) {
    this.keyPath = path.join(dataDir, '.mcp-secret-key');
    this.storePath = path.join(dataDir, '.mcp-secrets.json');
    fs.mkdirSync(dataDir, { recursive: true });
  }

  private getKey(): Buffer {
    if (fs.existsSync(this.keyPath)) return fs.readFileSync(this.keyPath);
    const key = crypto.randomBytes(32);
    fs.writeFileSync(this.keyPath, key, { mode: 0o600 });
    return key;
  }

  private readStore(): Record<string, Record<string, string>> {
    if (!fs.existsSync(this.storePath)) return {};
    try { return JSON.parse(fs.readFileSync(this.storePath, 'utf8')); }
    catch { return {}; }
  }

  private writeStore(store: Record<string, Record<string, string>>): void {
    fs.writeFileSync(this.storePath, JSON.stringify(store, null, 2), { mode: 0o600 });
  }

  async set(mcpServerId: string, envKey: string, value: string): Promise<void> {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', this.getKey(), iv);
    const enc = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    const packed = Buffer.concat([iv, tag, enc]).toString('base64');
    const store = this.readStore();
    store[mcpServerId] ??= {};
    store[mcpServerId][envKey] = packed;
    this.writeStore(store);
  }

  async get(mcpServerId: string, envKey: string): Promise<string | null> {
    const packed = this.readStore()[mcpServerId]?.[envKey];
    if (!packed) return null;
    const buf = Buffer.from(packed, 'base64');
    const iv = buf.subarray(0, 12);
    const tag = buf.subarray(12, 28);
    const enc = buf.subarray(28);
    const decipher = crypto.createDecipheriv('aes-256-gcm', this.getKey(), iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(enc), decipher.final()]).toString('utf8');
  }

  async delete(mcpServerId: string, envKey: string): Promise<void> {
    const store = this.readStore();
    if (store[mcpServerId]) {
      delete store[mcpServerId][envKey];
      if (Object.keys(store[mcpServerId]).length === 0) delete store[mcpServerId];
      this.writeStore(store);
    }
  }

  async deleteAll(mcpServerId: string): Promise<void> {
    const store = this.readStore();
    delete store[mcpServerId];
    this.writeStore(store);
  }
}

const SERVICE = 'branching-bad-mcp';

async function tryKeytar(): Promise<any | null> {
  try {
    const mod = await import('keytar');
    return mod.default ?? mod;
  } catch { return null; }
}

export class KeychainSecretStore implements SecretStore {
  constructor(private readonly fallback: FallbackSecretStore) {}
  private account(id: string, key: string): string { return `${id}:${key}`; }

  async set(id: string, key: string, value: string): Promise<void> {
    const keytar = await tryKeytar();
    if (keytar) {
      try { await keytar.setPassword(SERVICE, this.account(id, key), value); return; }
      catch { /* fall through */ }
    }
    await this.fallback.set(id, key, value);
  }
  async get(id: string, key: string): Promise<string | null> {
    const keytar = await tryKeytar();
    if (keytar) {
      try { const v = await keytar.getPassword(SERVICE, this.account(id, key)); if (v != null) return v; }
      catch { /* fall through */ }
    }
    return this.fallback.get(id, key);
  }
  async delete(id: string, key: string): Promise<void> {
    const keytar = await tryKeytar();
    if (keytar) { try { await keytar.deletePassword(SERVICE, this.account(id, key)); } catch {} }
    await this.fallback.delete(id, key);
  }
  async deleteAll(id: string): Promise<void> {
    await this.fallback.deleteAll(id);
  }
}

export function createSecretStore(dataDir: string): SecretStore {
  const fallback = new FallbackSecretStore(dataDir);
  return new KeychainSecretStore(fallback);
}
