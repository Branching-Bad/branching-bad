import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import type { ScriptNode } from './model.js';
import { OutputBuffer, type OutputResult } from './outputBuffer.js';

export interface RunScriptInput {
  node: ScriptNode;
  stdinText: string;
  cwd: string;
  tmpDir: string;
  outputDir: string;
  onStdout: (chunk: Buffer) => void;
  onStderr: (chunk: Buffer) => void;
  registerProc?: (child: ChildProcess) => void;
}

export interface RunScriptResult {
  exitCode: number;
  stdout: OutputResult;
  stderr: OutputResult;
  durationMs: number;
}

interface CommandPlan {
  bin: string;
  args: string[];
  ext: string;
}

function planCommand(node: ScriptNode, resolvedFile: string): CommandPlan {
  if (node.lang === 'python') {
    return { bin: process.platform === 'win32' ? 'python' : 'python3', args: [resolvedFile], ext: '.py' };
  }
  if (node.lang === 'typescript') {
    return { bin: 'npx', args: ['-y', 'tsx', resolvedFile], ext: '.ts' };
  }
  const template = node.runCommand ?? '';
  const parts = template.split(/\s+/).filter(Boolean);
  if (parts.length === 0) throw new Error('empty runCommand');
  const hasPlaceholder = template.includes('{file}');
  const resolved = hasPlaceholder
    ? parts.map((p) => p.replace('{file}', resolvedFile))
    : [...parts, resolvedFile];
  return { bin: resolved[0], args: resolved.slice(1), ext: path.extname(resolvedFile) || '' };
}

export async function runScriptNode(input: RunScriptInput): Promise<RunScriptResult> {
  const { node, stdinText, cwd, tmpDir, outputDir } = input;
  let fileForCmd: string;
  if (node.source === 'inline') {
    fs.mkdirSync(tmpDir, { recursive: true });
    const plan0 = planCommand(node, 'placeholder');
    fileForCmd = path.join(tmpDir, `${node.id}${plan0.ext || '.txt'}`);
    fs.writeFileSync(fileForCmd, node.code ?? '', 'utf8');
  } else {
    fileForCmd = path.isAbsolute(node.filePath ?? '')
      ? (node.filePath as string)
      : path.resolve(cwd, node.filePath ?? '');
  }

  const plan = planCommand(node, fileForCmd);
  const started = Date.now();
  const stdoutBuf = new OutputBuffer(path.join(outputDir, `${node.id}.stdout`));
  const stderrBuf = new OutputBuffer(path.join(outputDir, `${node.id}.stderr`));

  return await new Promise<RunScriptResult>((resolve, reject) => {
    const child = spawn(plan.bin, plan.args, {
      cwd,
      shell: process.platform === 'win32',
      env: process.env,
    });
    input.registerProc?.(child);

    child.stdout.on('data', (c: Buffer) => { stdoutBuf.write(c); input.onStdout(c); });
    child.stderr.on('data', (c: Buffer) => { stderrBuf.write(c); input.onStderr(c); });

    child.on('error', (err) => reject(err));
    child.on('close', async (code) => {
      const stdout = await stdoutBuf.finalize();
      const stderr = await stderrBuf.finalize();
      resolve({
        exitCode: code ?? -1,
        stdout,
        stderr,
        durationMs: Date.now() - started,
      });
    });

    if (child.stdin) {
      child.stdin.write(stdinText);
      child.stdin.end();
    }
  });
}
