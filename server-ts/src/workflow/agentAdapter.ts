import path from 'node:path';
import type { AppState } from '../state.js';
import type { AgentNode } from './model.js';
import { OutputBuffer, type OutputResult } from './outputBuffer.js';
import { MsgStore } from '../msgStore.js';
import { spawnAgent } from '../executor/agent.js';
import { buildAgentCommand } from '../routes/shared.js';

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
