import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateGraph } from './validate.js';
import type { Graph } from './model.js';

const base = (): Graph => ({ nodes: [], edges: [] });

test('empty graph is valid', () => {
  assert.deepEqual(validateGraph(base()), []);
});

test('detects cycle', () => {
  const g: Graph = {
    nodes: [
      { id: 'a', kind: 'merge', label: 'a', position: { x: 0, y: 0 }, onFail: 'halt-subtree' },
      { id: 'b', kind: 'merge', label: 'b', position: { x: 0, y: 0 }, onFail: 'halt-subtree' },
    ],
    edges: [
      { id: 'e1', from: 'a', to: 'b', required: true, inputOrder: 1 },
      { id: 'e2', from: 'b', to: 'a', required: true, inputOrder: 1 },
    ],
  };
  const errs = validateGraph(g);
  assert.ok(errs.some((e) => e.includes('cycle')));
});

test('detects duplicate inputOrder on same target', () => {
  const g: Graph = {
    nodes: [
      { id: 'a', kind: 'merge', label: 'a', position: { x: 0, y: 0 }, onFail: 'halt-subtree' },
      { id: 'b', kind: 'merge', label: 'b', position: { x: 0, y: 0 }, onFail: 'halt-subtree' },
      { id: 'c', kind: 'merge', label: 'c', position: { x: 0, y: 0 }, onFail: 'halt-subtree' },
    ],
    edges: [
      { id: 'e1', from: 'a', to: 'c', required: true, inputOrder: 1 },
      { id: 'e2', from: 'b', to: 'c', required: true, inputOrder: 1 },
    ],
  };
  const errs = validateGraph(g);
  assert.ok(errs.some((e) => e.includes('inputOrder')));
});

test('requires runCommand on custom lang script', () => {
  const g: Graph = {
    nodes: [
      {
        id: 'a', kind: 'script', label: 'a', position: { x: 0, y: 0 }, onFail: 'halt-subtree',
        lang: 'custom', source: 'inline', code: 'echo hi',
      },
    ],
    edges: [],
  };
  const errs = validateGraph(g);
  assert.ok(errs.some((e) => e.includes('runCommand')));
});

test('requires agent profile + prompt on agent node', () => {
  const g: Graph = {
    nodes: [
      {
        id: 'a', kind: 'agent', label: 'a', position: { x: 0, y: 0 }, onFail: 'halt-subtree',
        agentProfileId: '', promptTemplate: '',
      },
    ],
    edges: [],
  };
  const errs = validateGraph(g);
  assert.ok(errs.some((e) => e.includes('agentProfileId')));
  assert.ok(errs.some((e) => e.includes('promptTemplate')));
});
