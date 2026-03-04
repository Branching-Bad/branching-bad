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
): { args: string[]; codexLastMessagePath: string | null } {
  const isClaude = binaryLower.includes('claude');
  const isCodex = binaryLower.includes('codex');
  const codexExplicitExec = extraArgs[0] === 'exec';
  const args: string[] = [...extraArgs];
  let codexLastMessagePath: string | null = null;

  if (isClaude) {
    if (resumeSessionId) {
      args.push('--resume', resumeSessionId, '-p', prompt);
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
    args.push(prompt);
    codexLastMessagePath = outputFile;
  } else if (binaryLower.includes('gemini')) {
    args.push('-p', prompt, '--approval-mode', 'yolo');
  } else {
    args.push('-p', prompt);
  }

  return { args, codexLastMessagePath };
}
