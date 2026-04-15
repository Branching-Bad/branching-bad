import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FallbackSecretStore } from './secretStore.js';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

test('AES fallback roundtrips set/get/delete', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-'));
  const store = new FallbackSecretStore(dir);
  await store.set('srv1', 'AWS_SECRET_ACCESS_KEY', 'super-secret');
  assert.equal(await store.get('srv1', 'AWS_SECRET_ACCESS_KEY'), 'super-secret');
  await store.delete('srv1', 'AWS_SECRET_ACCESS_KEY');
  assert.equal(await store.get('srv1', 'AWS_SECRET_ACCESS_KEY'), null);
  fs.rmSync(dir, { recursive: true });
});

test('AES fallback deleteAll clears a server', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-'));
  const store = new FallbackSecretStore(dir);
  await store.set('srv2', 'K1', 'v1');
  await store.set('srv2', 'K2', 'v2');
  await store.deleteAll('srv2');
  assert.equal(await store.get('srv2', 'K1'), null);
  assert.equal(await store.get('srv2', 'K2'), null);
  fs.rmSync(dir, { recursive: true });
});
