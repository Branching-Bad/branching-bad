import { spawn, type ChildProcess } from 'child_process';
import { createInterface } from 'readline';

import type { MsgStore } from '../msgStore.js';
import { isStructuredCliEvent } from './shell.js';
import { splitCommand } from './command-parser.js';
import { parseClaudeStreamJson, parseGeminiStreamJson } from './stream-parser.js';
import { parseCodexExecJson } from './codexParser.js';

// ---------------------------------------------------------------------------
// Agent kind detection
// ---------------------------------------------------------------------------

function detectAgentKind(command: string): string {
  const lower = command.toLowerCase();
  if (lower.includes('claude')) return 'claude';
  if (lower.includes('codex')) return 'codex';
  if (lower.includes('gemini')) return 'gemini';
  if (lower.includes('opencode')) return 'opencode';
  return 'generic';
}

// ---------------------------------------------------------------------------
// buildAgentArgs
// ---------------------------------------------------------------------------

function buildAgentArgs(
  agentKind: string,
  extraArgs: string[],
  prompt: string,
  sessionId: string | null = null,
): { args: string[]; useStdinPipe: boolean; stdinPrompt: string | null } {
  const args = [...extraArgs];
  let useStdinPipe = false;
  let stdinPrompt: string | null = null;
  const codexExplicitExec = extraArgs[0] === 'exec';

  // On Windows, shell: true is required for .cmd shim resolution but cmd.exe
  // mangles special characters and imposes an ~8191-char command-line limit.
  // Always pipe the prompt via stdin on Windows to avoid both issues.
  const isWindows = process.platform === 'win32';
  const useStdinForPrompt = isWindows;

  switch (agentKind) {
    case 'claude': {
      if (sessionId) {
        args.push('--resume', sessionId);
      }
      useStdinPipe = true;
      if (useStdinForPrompt) {
        stdinPrompt = prompt;
        args.push('-p');
      } else {
        args.push('-p', prompt);
      }
      args.push('--permission-mode', 'bypassPermissions');
      args.push('--dangerously-skip-permissions');
      args.push('--output-format', 'stream-json');
      args.push('--verbose');
      break;
    }
    case 'codex': {
      if (sessionId) {
        if (!codexExplicitExec) args.push('exec');
        args.push('resume', sessionId);
      } else {
        if (!codexExplicitExec) args.push('exec');
      }
      args.push('--dangerously-bypass-approvals-and-sandbox');
      args.push('--json');
      // Codex reads prompt from stdin when not provided as positional arg
      if (useStdinForPrompt) {
        useStdinPipe = true;
        stdinPrompt = prompt;
      } else {
        args.push(prompt);
      }
      break;
    }
    case 'gemini': {
      if (sessionId) {
        args.push('-r', sessionId);
      }
      if (useStdinForPrompt) {
        useStdinPipe = true;
        stdinPrompt = prompt;
        args.push('-p');
      } else {
        args.push('-p', prompt);
      }
      args.push('--approval-mode', 'yolo');
      args.push('--output-format', 'stream-json');
      break;
    }
    default: {
      if (useStdinForPrompt) {
        useStdinPipe = true;
        stdinPrompt = prompt;
      } else {
        args.push('-p', prompt);
      }
      break;
    }
  }

  return { args, useStdinPipe, stdinPrompt };
}

// ---------------------------------------------------------------------------
// setupStdoutReader
// ---------------------------------------------------------------------------

function setupStdoutReader(child: ChildProcess, agentKind: string, store: MsgStore): void {
  if (!child.stdout) return;

  const rl = createInterface({ input: child.stdout });
  rl.on('line', (line: string) => {
    if (agentKind === 'claude') {
      const parsed = parseClaudeStreamJson(line);
      if (parsed) {
        if (parsed.sessionId) store.setSessionId(parsed.sessionId);
        if (parsed.msg.data) store.push(parsed.msg);
        return;
      }
      if (isStructuredCliEvent(line)) return;
    } else if (agentKind === 'codex') {
      const parsed = parseCodexExecJson(line);
      if (parsed) {
        if (parsed.sessionId) store.setSessionId(parsed.sessionId);
        if (parsed.msg.data) store.push(parsed.msg);
        return;
      }
      if (isStructuredCliEvent(line)) return;
    }

    if (agentKind === 'gemini') {
      const parsed = parseGeminiStreamJson(line);
      if (parsed) {
        if (parsed.sessionId) store.setSessionId(parsed.sessionId);
        if (parsed.msg.data) store.push(parsed.msg);
        return;
      }
      if (isStructuredCliEvent(line)) return;
    }

    store.push({ type: 'stdout', data: line });
  });
}

// ---------------------------------------------------------------------------
// spawnAgent
// ---------------------------------------------------------------------------

/**
 * Spawn an AI agent process with structured output parsing.
 * Sets up line-by-line stdout/stderr readers that push messages to the MsgStore.
 *
 * @param mcpExtraArgs - Additional CLI args to inject before the agent runs (e.g. --mcp-config <path>).
 * @param mcpExtraEnv  - Additional env vars to merge in (e.g. CODEX_CONFIG_DIR). No secrets are logged.
 */
export function spawnAgent(
  agentCommand: string,
  prompt: string,
  workingDir: string,
  store: MsgStore,
  sessionId: string | null = null,
  mcpExtraArgs: string[] = [],
  mcpExtraEnv: Record<string, string> = {},
): ChildProcess {
  const parts = splitCommand(agentCommand);
  if (parts.length === 0) {
    throw new Error('empty agent command');
  }

  const [bin, ...baseArgs] = parts;
  const agentKind = detectAgentKind(agentCommand);
  const { args: builtArgs, useStdinPipe, stdinPrompt } = buildAgentArgs(agentKind, baseArgs, prompt, sessionId);

  // Inject MCP args after the built args (global flags accepted anywhere by claude/gemini CLIs).
  const args = mcpExtraArgs.length > 0 ? [...builtArgs, ...mcpExtraArgs] : builtArgs;

  // Strip env vars that trigger "nested Claude Code session" errors
  const env: Record<string, string> = { ...process.env } as Record<string, string>;
  for (const key of Object.keys(env)) {
    if (key === 'CLAUDECODE' || key.startsWith('CLAUDE_CODE_')) {
      delete env[key];
    }
  }
  delete env['CLAUDE_AGENT_SDK_VERSION'];

  // Merge MCP env vars (done after stripping to avoid leaking internal vars)
  Object.assign(env, mcpExtraEnv);

  const child = spawn(bin, args, {
    cwd: workingDir,
    stdio: [useStdinPipe ? 'pipe' : 'ignore', 'pipe', 'pipe'],
    env,
    shell: process.platform === 'win32',
  });

  // Handle spawn errors (e.g. ENOENT when cmd.exe or binary not found)
  // to prevent unhandled error events from crashing the process.
  child.on('error', (err) => {
    store.pushStderr(`Agent spawn error: ${err.message}`);
    store.pushFinished(null, 'failed');
  });

  if (useStdinPipe && child.stdin) {
    if (stdinPrompt) {
      child.stdin.write(stdinPrompt);
    }
    child.stdin.end();
  }

  setupStdoutReader(child, agentKind, store);

  if (child.stderr) {
    const rl = createInterface({ input: child.stderr });
    rl.on('line', (line: string) => {
      store.push({ type: 'stderr', data: line });
    });
  }

  return child;
}
