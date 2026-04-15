import fs from 'node:fs';
import path from 'node:path';
import type { AppState } from '../state.js';
import type { AgentNode, McpNode } from './model.js';
import { OutputBuffer, type OutputResult } from './outputBuffer.js';
import { MsgStore } from '../msgStore.js';
import { spawnAgent } from '../executor/agent.js';
import { buildAgentCommand, getAppDataDir } from '../routes/shared.js';
import { loadCatalog } from '../mcp/catalog.js';
import { resolveMcpServer } from '../mcp/resolver.js';
import { writeAgentConfig } from '../mcp/configWriter.js';
import type { AgentFlavor } from '../mcp/model.js';

const FLAVOR_KEYWORDS: [string, AgentFlavor][] = [
  ['claude', 'claude'],
  ['codex', 'codex'],
  ['gemini', 'gemini'],
];

function detectFlavor(cmd: string): AgentFlavor | null {
  const lower = cmd.toLowerCase();
  for (const [kw, flavor] of FLAVOR_KEYWORDS) {
    if (lower.includes(kw)) return flavor;
  }
  return null;
}

const WORKFLOW_AGENT_SYSTEM = `You are an agent invoked from a Workflow pipeline controlled by a proxy system.
This prompt comes from the proxy, NOT from the user.
Emit exactly one final message that fully answers the request — no interactive follow-up, no clarifying questions.
Tool use is allowed; when you are done using tools, produce your final response as plain text. That final message is the only output piped to the next workflow step.`;

export interface RunAgentInput {
  node: AgentNode;
  stdinText: string;
  repoPath: string;
  outputDir: string;
  state: AppState;
  onStdout: (chunk: Buffer) => void;
  onStderr: (chunk: Buffer) => void;
}

export interface RunAgentResult {
  exitCode: number;
  stdout: OutputResult;
  stderr: OutputResult;
  durationMs: number;
}

export async function runAgentNode(input: RunAgentInput): Promise<RunAgentResult> {
  const { node, stdinText, repoPath, outputDir, state, onStdout, onStderr } = input;

  const profile = state.db.getAgentProfileById(node.agentProfileId);
  if (!profile) throw new Error(`agent profile ${node.agentProfileId} not found`);

  const agentCommand = buildAgentCommand(profile);
  if (!agentCommand.trim()) throw new Error(`agent profile ${node.agentProfileId} has no command`);

  const promptBody = node.promptTemplate
    .replaceAll('{input}', stdinText)
    .replaceAll('{repo}', repoPath);

  const fullPrompt = `${WORKFLOW_AGENT_SYSTEM}\n\n---\nUser message (from proxy):\n${promptBody}`;

  const stderrBuf = new OutputBuffer(path.join(outputDir, 'stderr.txt'));
  const stdoutBuf = new OutputBuffer(path.join(outputDir, 'stdout.txt'));

  const store = new MsgStore();
  const startMs = Date.now();

  return new Promise<RunAgentResult>((resolve) => {
    const child = spawnAgent(agentCommand, fullPrompt, repoPath, store);

    // Route MsgStore messages to the appropriate buffers + caller callbacks
    const unsubscribe = store.subscribe((msg) => {
      if (msg.type === 'agent_text') {
        // Final assistant text — goes to stdout only
        const chunk = Buffer.from(msg.data, 'utf8');
        stdoutBuf.write(chunk);
        onStdout(chunk);
      } else if (msg.type === 'stderr') {
        const chunk = Buffer.from(msg.data + '\n', 'utf8');
        stderrBuf.write(chunk);
        onStderr(chunk);
      } else if (msg.type === 'thinking' || msg.type === 'tool_use' || msg.type === 'tool_result' || msg.type === 'stdout') {
        // Intermediate chatter — goes to stderr side channel
        const chunk = Buffer.from(msg.data + '\n', 'utf8');
        stderrBuf.write(chunk);
        onStderr(chunk);
      }
      // 'finished', 'agent_done', 'user_message', 'turn_separator' — ignored
    });

    child.on('exit', async (code) => {
      unsubscribe();
      const durationMs = Date.now() - startMs;
      const exitCodeRaw = code ?? -1;

      const [stdoutResult, stderrResult] = await Promise.all([
        stdoutBuf.finalize(),
        stderrBuf.finalize(),
      ]);

      // exitCode: 0 if a final message was produced, otherwise child's exit code
      const exitCode = stdoutResult.inline != null || stdoutResult.filePath != null
        ? 0
        : (exitCodeRaw !== 0 ? exitCodeRaw : -1);

      resolve({ exitCode, stdout: stdoutResult, stderr: stderrResult, durationMs });
    });
  });
}

// ── MCP node runner ───────────────────────────────────────────────────────────

export interface RunMcpInput {
  node: McpNode;
  stdinText: string;
  repoPath: string;
  outputDir: string;
  state: AppState;
  onStdout: (chunk: Buffer) => void;
  onStderr: (chunk: Buffer) => void;
}

export async function runMcpNode(input: RunMcpInput): Promise<RunAgentResult> {
  const { node, stdinText, repoPath, outputDir, state, onStdout, onStderr } = input;

  if (!node.agentProfileId) throw new Error('MCP node: agentProfileId is required');
  if (!node.mcpServerId) throw new Error('MCP node: mcpServerId is required');
  if (node.promptTemplate == null) throw new Error('MCP node: promptTemplate is required');

  const profile = state.db.getAgentProfileById(node.agentProfileId);
  if (!profile) throw new Error(`agent profile ${node.agentProfileId} not found`);

  const agentCommand = buildAgentCommand(profile);
  if (!agentCommand.trim()) throw new Error(`agent profile ${node.agentProfileId} has no command`);

  const server = state.db.getMcpServer(node.mcpServerId);
  if (!server) throw new Error(`MCP server ${node.mcpServerId} not found`);

  const promptBody = node.promptTemplate
    .replaceAll('{input}', stdinText)
    .replaceAll('{repo}', repoPath);

  const fullPrompt = `${WORKFLOW_AGENT_SYSTEM}\n\n---\nUser message (from proxy):\n${promptBody}`;

  const stderrBuf = new OutputBuffer(path.join(outputDir, 'stderr.txt'));
  const stdoutBuf = new OutputBuffer(path.join(outputDir, 'stdout.txt'));

  // Resolve and write config for exactly this one MCP server (override)
  let extraArgs: string[] = [];
  let extraEnv: Record<string, string> = {};
  let mcpConfigDir: string | null = null;

  const flavor = detectFlavor(agentCommand);
  if (flavor) {
    const catalog = await loadCatalog();
    const resolved = await resolveMcpServer(server, catalog, state.secretStore);
    mcpConfigDir = path.join(getAppDataDir(), 'workflow_mcp_configs', `${node.id}-${Date.now()}`);
    const emission = await writeAgentConfig(flavor, [resolved], mcpConfigDir);
    if (emission.configPath) {
      if (flavor === 'claude') {
        extraArgs = ['--mcp-config', emission.configPath];
      } else if (flavor === 'codex') {
        extraEnv = { CODEX_CONFIG_DIR: path.dirname(emission.configPath) };
      } else if (flavor === 'gemini') {
        extraArgs = ['--settings', emission.configPath];
      }
    }
  }

  const store = new MsgStore();
  const startMs = Date.now();

  return new Promise<RunAgentResult>((resolve) => {
    const child = spawnAgent(agentCommand, fullPrompt, repoPath, store, null, extraArgs, extraEnv);

    if (mcpConfigDir) {
      const dirToRemove = mcpConfigDir;
      child.on('exit', () => {
        fs.promises.rm(dirToRemove, { recursive: true, force: true }).catch(() => {});
      });
    }

    const unsubscribe = store.subscribe((msg) => {
      if (msg.type === 'agent_text') {
        const chunk = Buffer.from(msg.data, 'utf8');
        stdoutBuf.write(chunk);
        onStdout(chunk);
      } else if (msg.type === 'stderr') {
        const chunk = Buffer.from(msg.data + '\n', 'utf8');
        stderrBuf.write(chunk);
        onStderr(chunk);
      } else if (msg.type === 'thinking' || msg.type === 'tool_use' || msg.type === 'tool_result' || msg.type === 'stdout') {
        const chunk = Buffer.from(msg.data + '\n', 'utf8');
        stderrBuf.write(chunk);
        onStderr(chunk);
      }
    });

    child.on('exit', async (code) => {
      unsubscribe();
      const durationMs = Date.now() - startMs;
      const exitCodeRaw = code ?? -1;

      const [stdoutResult, stderrResult] = await Promise.all([
        stdoutBuf.finalize(),
        stderrBuf.finalize(),
      ]);

      const exitCode = stdoutResult.inline != null || stdoutResult.filePath != null
        ? 0
        : (exitCodeRaw !== 0 ? exitCodeRaw : -1);

      resolve({ exitCode, stdout: stdoutResult, stderr: stderrResult, durationMs });
    });
  });
}
