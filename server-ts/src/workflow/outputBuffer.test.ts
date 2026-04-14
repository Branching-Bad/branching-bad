import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { OutputBuffer } from './outputBuffer.js';

test('keeps small data inline', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ob-'));
  const buf = new OutputBuffer(path.join(dir, 'out'));
  buf.write(Buffer.from('hello'));
  const res = await buf.finalize();
  assert.equal(res.inline, 'hello');
  assert.equal(res.filePath, null);
  fs.rmSync(dir, { recursive: true });
});

test('spills to file when over 1 MiB', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ob-'));
  const filePath = path.join(dir, 'out');
  const buf = new OutputBuffer(filePath);
  const big = Buffer.alloc(2 * 1024 * 1024, 'x');
  buf.write(big);
  const res = await buf.finalize();
  assert.equal(res.inline?.length, 1024 * 1024);
  assert.equal(res.filePath, filePath);
  const stat = fs.statSync(filePath);
  assert.equal(stat.size, 2 * 1024 * 1024);
  fs.rmSync(dir, { recursive: true });
});
