import { spawn, type ChildProcess } from 'child_process';
import { createInterface } from 'readline';

import type { MsgStore } from '../msgStore.js';
import { isStructuredCliEvent } from './shell.js';
import { splitCommand } from './command-parser.js';
import { parseClaudeStreamJson } from './stream-parser.js';
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
): { args: string[]; useStdinPipe: boolean } {
  const args = [...extraArgs];
  let useStdinPipe = false;
  const codexExplicitExec = extraArgs[0] === 'exec';

  switch (agentKind) {
    case 'claude': {
      useStdinPipe = true;
      args.push('-p', prompt);
      args.push('--permission-mode', 'bypassPermissions');
      args.push('--dangerously-skip-permissions');
      args.push('--output-format', 'stream-json');
      args.push('--verbose');
      break;
    }
    case 'codex': {
      if (!codexExplicitExec) args.push('exec');
      args.push('--dangerously-bypass-approvals-and-sandbox');
      args.push('--json');
      args.push(prompt);
      break;
    }
    case 'gemini': {
      args.push('-p', prompt);
      args.push('--approval-mode', 'yolo');
      break;
    }
    default: {
      args.push('-p', prompt);
      break;
    }
  }

  return { args, useStdinPipe };
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
        store.push(parsed);
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
 */
export function spawnAgent(
  agentCommand: string,
  prompt: string,
  workingDir: string,
  store: MsgStore,
): ChildProcess {
  const parts = splitCommand(agentCommand);
  if (parts.length === 0) {
    throw new Error('empty agent command');
  }

  const [bin, ...extraArgs] = parts;
  const agentKind = detectAgentKind(agentCommand);
  const { args, useStdinPipe } = buildAgentArgs(agentKind, extraArgs, prompt);

  // Strip env vars that trigger "nested Claude Code session" errors
  const env = { ...process.env };
  delete env.CLAUDECODE;
  delete env.CLAUDE_CODE_ENTRYPOINT;

  const child = spawn(bin, args, {
    cwd: workingDir,
    stdio: [useStdinPipe ? 'pipe' : 'ignore', 'pipe', 'pipe'],
    env,
    shell: process.platform === 'win32',
  });

  if (useStdinPipe && child.stdin) {
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
