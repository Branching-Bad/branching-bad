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

test('empty required fields are tolerated at save (runtime validates)', () => {
  // Drafts with empty code/prompt/runCommand should save cleanly.
  // Runtime exec surfaces these as failed attempts with clear stderr.
  const g: Graph = {
    nodes: [
      {
        id: 'a', kind: 'script', label: 'a', position: { x: 0, y: 0 }, onFail: 'halt-subtree',
        lang: 'custom', source: 'inline', code: '', runCommand: '',
      },
      {
        id: 'b', kind: 'agent', label: 'b', position: { x: 0, y: 0 }, onFail: 'halt-subtree',
        agentProfileId: '', promptTemplate: '',
      },
    ],
    edges: [],
  };
  assert.deepEqual(validateGraph(g), []);
});
