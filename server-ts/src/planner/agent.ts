import { spawn } from 'child_process';
import { createInterface } from 'readline';
import fs from 'fs';
import treeKill from 'tree-kill';

import { splitCommand } from '../executor/index.js';
import { buildAgentArgs } from './agentArgs.js';
import { emitProgress } from './helpers.js';
import { parseClaudeStreamLine } from './stream-parsers.js';
import { extractTextFromClaudeStream, truncateProgressLine } from './stream-extract.js';
import type { AgentOutput, ProgressCallback } from './types.js';

const DEFAULT_AGENT_TIMEOUT_SECS = 60 * 60;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function invokeAgentCli(
  agentCommand: string,
  prompt: string,
  workingDir: string,
  progress: ProgressCallback | null,
  resumeSessionId: string | null,
): Promise<AgentOutput> {
  const parts = splitCommand(agentCommand);
  if (parts.length === 0) {
    throw new Error('Empty agent command');
  }

  const binary = parts[0];
  const binaryLower = binary.toLowerCase();
  const isClaude = binaryLower.includes('claude');
  const extraArgs = parts.slice(1);

  const { args, codexLastMessagePath } = buildAgentArgs(
    binary,
    binaryLower,
    extraArgs,
    prompt,
    resumeSessionId,
  );

  const env = buildCleanEnv();

  const child = spawn(binary, args, {
    cwd: workingDir,
    stdio: ['ignore', 'pipe', 'pipe'],
    env,
    shell: process.platform === 'win32',
  });

  const stdoutLines: string[] = [];
  const stderrLines: string[] = [];
  const state = { capturedSessionId: null as string | null, claudeFinalOutput: null as string | null };

  attachStdoutHandler(child, stdoutLines, isClaude, progress, state);
  attachStderrHandler(child, stderrLines, progress);

  const timeoutSecs = resolveAgentTimeoutSecs();
  const exitCode = await waitForExit(child, timeoutSecs);

  const stdout = stdoutLines.join('\n');

  if (exitCode === 0) {
    return resolveSuccessOutput(codexLastMessagePath, isClaude, stdout, state);
  }

  if (codexLastMessagePath) {
    try { fs.unlinkSync(codexLastMessagePath); } catch { /* ignore */ }
  }

  const stderr = stderrLines.join('\n');
  throw new Error(`Agent command failed: ${stderr}`);
}

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

function resolveAgentTimeoutSecs(): number {
  const envVal = process.env['AGENT_PLAN_TIMEOUT_SECS'];
  let parsed = DEFAULT_AGENT_TIMEOUT_SECS;
  if (envVal) {
    const n = parseInt(envVal.trim(), 10);
    if (!isNaN(n)) {
      parsed = n;
    }
  }
  // 1 minute minimum, 2 hours maximum
  return Math.min(Math.max(parsed, 60), 7200);
}

function buildCleanEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  delete env['CLAUDECODE'];
  delete env['CLAUDE_CODE_ENTRYPOINT'];
  return env;
}

function attachStdoutHandler(
  child: ReturnType<typeof spawn>,
  stdoutLines: string[],
  isClaude: boolean,
  progress: ProgressCallback | null,
  state: { capturedSessionId: string | null; claudeFinalOutput: string | null },
): void {
  if (!child.stdout) return;

  const rl = createInterface({ input: child.stdout });
  rl.on('line', (line: string) => {
    stdoutLines.push(line);

    if (isClaude) {
      const { finalOutput, sessionId, messages } = parseClaudeStreamLine(line);
      if (finalOutput !== null) state.claudeFinalOutput = finalOutput;
      if (sessionId !== null) state.capturedSessionId = sessionId;
      for (const msg of messages) {
        emitProgress(progress, msg);
      }
    } else if (line.trim()) {
      emitProgress(progress, { type: 'stdout', data: truncateProgressLine(line) });
    }
  });
}

function attachStderrHandler(
  child: ReturnType<typeof spawn>,
  stderrLines: string[],
  progress: ProgressCallback | null,
): void {
  if (!child.stderr) return;

  const rl = createInterface({ input: child.stderr });
  rl.on('line', (line: string) => {
    stderrLines.push(line);
    if (line.trim()) {
      emitProgress(progress, { type: 'stderr', data: truncateProgressLine(line) });
    }
  });
}

function waitForExit(
  child: ReturnType<typeof spawn>,
  timeoutSecs: number,
): Promise<number | null> {
  return new Promise<number | null>((resolve, reject) => {
    const timer = setTimeout(() => {
      if (child.pid != null) {
        treeKill(child.pid, 'SIGTERM', () => {
          setTimeout(() => {
            if (child.pid != null) {
              treeKill(child.pid, 'SIGKILL', () => { /* ignore */ });
            }
          }, 5000);
        });
      }
      reject(new Error(`Agent command timed out after ${timeoutSecs}s`));
    }, timeoutSecs * 1000);

    child.on('exit', (code) => {
      clearTimeout(timer);
      resolve(code);
    });

    child.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

function resolveSuccessOutput(
  codexLastMessagePath: string | null,
  isClaude: boolean,
  stdout: string,
  state: { capturedSessionId: string | null; claudeFinalOutput: string | null },
): AgentOutput {
  // Codex: prefer last-message file
  if (codexLastMessagePath) {
    try {
      const lastMessage = fs.readFileSync(codexLastMessagePath, 'utf8');
      try { fs.unlinkSync(codexLastMessagePath); } catch { /* ignore */ }
      if (lastMessage.trim()) {
        return { text: lastMessage, session_id: state.capturedSessionId };
      }
    } catch {
      // File may not exist, continue to fallback
    }
  }

  // Claude: prefer final_output from stream-json parsing
  if (isClaude) {
    if (state.claudeFinalOutput && state.claudeFinalOutput.trim()) {
      return { text: state.claudeFinalOutput, session_id: state.capturedSessionId };
    }
    const extracted = extractTextFromClaudeStream(stdout);
    if (extracted.trim()) {
      return { text: extracted, session_id: state.capturedSessionId };
    }
  }

  return { text: stdout, session_id: state.capturedSessionId };
}
