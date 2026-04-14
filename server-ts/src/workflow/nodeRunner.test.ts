import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { runScriptNode } from './nodeRunner.js';
import type { ScriptNode } from './model.js';

const tmpBase = () => fs.mkdtempSync(path.join(os.tmpdir(), 'wf-'));

test('inline python echoes stdin to stdout', async (t) => {
  t.diagnostic('requires python3 on PATH');
  const dir = tmpBase();
  const node: ScriptNode = {
    id: 'n1', kind: 'script', label: 'n1', position: { x: 0, y: 0 }, onFail: 'halt-subtree',
    lang: 'python', source: 'inline', code: 'import sys;print(sys.stdin.read().upper(),end="")',
  };
  const res = await runScriptNode({
    node, stdinText: 'hello', cwd: dir, tmpDir: dir, outputDir: dir,
    onStdout: () => {}, onStderr: () => {},
  });
  assert.equal(res.exitCode, 0);
  assert.equal(res.stdout.inline, 'HELLO');
  fs.rmSync(dir, { recursive: true });
});

test('non-zero exit surfaces exit_code', async (t) => {
  t.diagnostic('requires python3 on PATH');
  const dir = tmpBase();
  const node: ScriptNode = {
    id: 'n2', kind: 'script', label: 'n2', position: { x: 0, y: 0 }, onFail: 'halt-subtree',
    lang: 'python', source: 'inline', code: 'import sys;sys.exit(3)',
  };
  const res = await runScriptNode({
    node, stdinText: '', cwd: dir, tmpDir: dir, outputDir: dir,
    onStdout: () => {}, onStderr: () => {},
  });
  assert.equal(res.exitCode, 3);
  fs.rmSync(dir, { recursive: true });
});
