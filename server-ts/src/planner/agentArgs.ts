import os from 'os';
import path from 'path';

// ---------------------------------------------------------------------------
// Agent argument construction
// ---------------------------------------------------------------------------

export function buildAgentArgs(
  binary: string,
  binaryLower: string,
  extraArgs: string[],
  prompt: string,
  resumeSessionId: string | null,
): { args: string[]; codexLastMessagePath: string | null; useStdinPrompt: boolean } {
  const isClaude = binaryLower.includes('claude');
  const isCodex = binaryLower.includes('codex');
  const codexExplicitExec = extraArgs[0] === 'exec';
  const args: string[] = [...extraArgs];
  let codexLastMessagePath: string | null = null;

  // On Windows, shell: true is required for .cmd shim resolution but the
  // prompt goes through cmd.exe which mangles special characters (&, |, <, >,
  // quotes, newlines, etc.) and imposes an ~8191-char command-line limit.
  // Always pipe the prompt via stdin on Windows to avoid both issues.
  const isWindows = process.platform === 'win32';
  const useStdinPrompt = isWindows;

  if (isClaude) {
    if (resumeSessionId) {
      args.push('--resume', resumeSessionId);
    }
    if (useStdinPrompt) {
      args.push('-p');
    } else {
      args.push('-p', prompt);
    }
    args.push(
      '--permission-mode', 'bypassPermissions',
      '--dangerously-skip-permissions',
      '--output-format', 'stream-json',
      '--verbose',
    );
  } else if (isCodex) {
    if (!codexExplicitExec) {
      args.push('exec');
    }
    args.push('--dangerously-bypass-approvals-and-sandbox');
    args.push('--json');
    const outputFile = path.join(
      os.tmpdir(),
      `approval-agent-plan-${process.pid}-${Date.now()}.txt`,
    );
    args.push('--output-last-message', outputFile);
    // Codex reads prompt from stdin when not provided as positional arg
    if (!useStdinPrompt) {
      args.push(prompt);
    }
    codexLastMessagePath = outputFile;
  } else if (binaryLower.includes('gemini')) {
    if (useStdinPrompt) {
      args.push('--approval-mode', 'yolo');
    } else {
      args.push('-p', prompt, '--approval-mode', 'yolo');
    }
  } else {
    if (!useStdinPrompt) {
      args.push('-p', prompt);
    }
  }

  return { args, codexLastMessagePath, useStdinPrompt };
}
