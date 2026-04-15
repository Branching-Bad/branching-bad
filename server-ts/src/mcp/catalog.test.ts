import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadCatalog, getEntry } from './catalog.js';

test('loads bundled catalog', async () => {
  const cat = await loadCatalog();
  assert.equal(cat.version, 1);
  assert.ok(cat.entries['aws-cloudwatch']);
  assert.ok(cat.entries['custom']);
});

test('getEntry returns entry or undefined', async () => {
  const cat = await loadCatalog();
  assert.equal(getEntry(cat, 'github')?.publisher, 'GitHub');
  assert.equal(getEntry(cat, 'nope'), undefined);
});
