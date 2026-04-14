import { test } from 'node:test';
import assert from 'node:assert/strict';
import { executeGraph, type NodeExecutor } from './runner.js';
import type { Graph, ScriptNode } from './model.js';

const mkScript = (id: string, onFail: 'halt-subtree' | 'halt-all' = 'halt-subtree'): ScriptNode => ({
  id, kind: 'script', label: id, position: { x: 0, y: 0 }, onFail,
  lang: 'python', source: 'inline', code: 'pass',
});

function runFor(map: Record<string, { exit: number; stdout?: string }>): NodeExecutor {
  return async ({ node }) => {
    const r = map[node.id];
    return { exitCode: r.exit, stdout: r.stdout ?? '', stderr: '' };
  };
}

test('linear graph runs in order and passes stdin', async () => {
  const g: Graph = {
    nodes: [mkScript('a'), mkScript('b'), mkScript('c')],
    edges: [
      { id: 'e1', from: 'a', to: 'b', required: true, inputOrder: 1 },
      { id: 'e2', from: 'b', to: 'c', required: true, inputOrder: 1 },
    ],
  };
  const seen: Record<string, string> = {};
  const exec: NodeExecutor = async ({ node, stdinText }) => {
    seen[node.id] = stdinText;
    return { exitCode: 0, stdout: node.id.toUpperCase(), stderr: '' };
  };
  const res = await executeGraph(g, exec);
  assert.equal(res.status, 'done');
  assert.equal(seen.a, '');
  assert.equal(seen.b, 'A');
  assert.equal(seen.c, 'B');
});

test('concatenates multiple parents by inputOrder', async () => {
  const g: Graph = {
    nodes: [mkScript('a'), mkScript('b'), mkScript('c')],
    edges: [
      { id: 'e1', from: 'a', to: 'c', required: true, inputOrder: 2 },
      { id: 'e2', from: 'b', to: 'c', required: true, inputOrder: 1 },
    ],
  };
  const stdoutMap: Record<string, string> = { a: 'AA', b: 'BB', c: '' };
  let cStdin = '';
  const exec: NodeExecutor = async ({ node, stdinText }) => {
    if (node.id === 'c') cStdin = stdinText;
    return { exitCode: 0, stdout: stdoutMap[node.id], stderr: '' };
  };
  const res = await executeGraph(g, exec);
  assert.equal(res.status, 'done');
  assert.equal(cStdin, 'BBAA');
});

test('required edge from failed parent skips child', async () => {
  const g: Graph = {
    nodes: [mkScript('a'), mkScript('b'), mkScript('c')],
    edges: [
      { id: 'e1', from: 'a', to: 'c', required: true, inputOrder: 1 },
      { id: 'e2', from: 'b', to: 'c', required: false, inputOrder: 2 },
    ],
  };
  const exec = runFor({ a: { exit: 1 }, b: { exit: 0, stdout: 'ok' }, c: { exit: 0 } });
  const res = await executeGraph(g, exec);
  assert.equal(res.perNode.a.status, 'failed');
  assert.equal(res.perNode.b.status, 'done');
  assert.equal(res.perNode.c.status, 'skipped');
  assert.equal(res.status, 'failed');
});

test('optional edge from failed parent still runs child', async () => {
  const g: Graph = {
    nodes: [mkScript('a'), mkScript('b'), mkScript('c')],
    edges: [
      { id: 'e1', from: 'a', to: 'c', required: false, inputOrder: 1 },
      { id: 'e2', from: 'b', to: 'c', required: true, inputOrder: 2 },
    ],
  };
  const exec = runFor({ a: { exit: 1 }, b: { exit: 0, stdout: 'BB' }, c: { exit: 0, stdout: 'OK' } });
  const res = await executeGraph(g, exec);
  assert.equal(res.perNode.c.status, 'done');
});

test('halt-all cancels independent branches', async () => {
  const a = mkScript('a');
  const b = mkScript('b', 'halt-all');
  const c = mkScript('c');
  const g: Graph = {
    nodes: [a, b, c],
    edges: [
      { id: 'e1', from: 'a', to: 'b', required: true, inputOrder: 1 },
      { id: 'e2', from: 'a', to: 'c', required: true, inputOrder: 1 },
    ],
  };
  const exec: NodeExecutor = async ({ node }) => {
    if (node.id === 'a') return { exitCode: 0, stdout: 'A', stderr: '' };
    if (node.id === 'b') return { exitCode: 1, stdout: '', stderr: 'fail' };
    await new Promise((r) => setTimeout(r, 10));
    return { exitCode: 0, stdout: '', stderr: '' };
  };
  const res = await executeGraph(g, exec);
  assert.equal(res.status, 'halted');
  assert.ok(res.perNode.c.status === 'cancelled' || res.perNode.c.status === 'skipped');
});
