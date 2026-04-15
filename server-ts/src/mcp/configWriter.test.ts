import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { writeAgentConfig } from './configWriter.js';
import type { ResolvedMcpServer } from './model.js';

const sampleServer = (): ResolvedMcpServer => ({
  id: 'id-1',
  name: 'prod-cw',
  command: 'uvx',
  args: ['awslabs.cloudwatch-logs-mcp-server'],
  env: { AWS_REGION: 'us-east-1', AWS_ACCESS_KEY_ID: 'AKIA' },
});

test('claude: emits mcpServers json', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cfg-'));
  const result = await writeAgentConfig('claude', [sampleServer()], dir);
  const body = JSON.parse(fs.readFileSync(result.configPath!, 'utf8'));
  assert.ok(body.mcpServers['prod-cw']);
  assert.equal(body.mcpServers['prod-cw'].command, 'uvx');
  assert.deepEqual(body.mcpServers['prod-cw'].env, { AWS_REGION: 'us-east-1', AWS_ACCESS_KEY_ID: 'AKIA' });
  fs.rmSync(dir, { recursive: true });
});

test('codex: emits toml with per-server sections', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cfg-'));
  const result = await writeAgentConfig('codex', [sampleServer()], dir);
  const body = fs.readFileSync(result.configPath!, 'utf8');
  assert.ok(body.includes('[mcp_servers.prod-cw]'));
  assert.ok(body.includes('command = "uvx"'));
  assert.ok(body.includes('AWS_REGION = "us-east-1"'));
  fs.rmSync(dir, { recursive: true });
});

test('gemini: emits settings.json', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cfg-'));
  const result = await writeAgentConfig('gemini', [sampleServer()], dir);
  const body = JSON.parse(fs.readFileSync(result.configPath!, 'utf8'));
  assert.ok(body.mcpServers['prod-cw']);
  fs.rmSync(dir, { recursive: true });
});

test('empty server list returns null path', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cfg-'));
  const result = await writeAgentConfig('claude', [], dir);
  assert.equal(result.configPath, null);
  fs.rmSync(dir, { recursive: true });
});
