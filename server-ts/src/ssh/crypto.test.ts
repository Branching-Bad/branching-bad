import { test } from 'node:test';
import assert from 'node:assert';
import * as os from 'node:os';
import * as path from 'node:path';
import * as fs from 'node:fs';

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
