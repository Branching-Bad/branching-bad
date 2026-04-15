import * as fs from 'node:fs';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import { getAppDataDir } from '../routes/shared.js';

const MASTER_KEY_FILE = '.ssh_master_key';
const KEY_LEN = 32;
const IV_LEN = 12;
const TAG_LEN = 16;

let cachedKey: Buffer | null = null;

function masterKeyPath(): string {
  return path.join(getAppDataDir(), MASTER_KEY_FILE);
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
  const key = crypto.randomBytes(KEY_LEN);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const fd = fs.openSync(p, 'wx', 0o600);
  try {
    fs.writeSync(fd, key);
  } finally {
    fs.closeSync(fd);
  }
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
    if (buf.length < IV_LEN + TAG_LEN) return null;
    const iv = buf.subarray(0, IV_LEN);
    const tag = buf.subarray(buf.length - TAG_LEN);
    const ct = buf.subarray(IV_LEN, buf.length - TAG_LEN);
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);
    const pt = Buffer.concat([decipher.update(ct), decipher.final()]);
    return pt.toString('utf8');
  } catch {
    return null;
  }
}
