import { spawnSync } from 'child_process';

// ---------------------------------------------------------------------------
// String helpers
// ---------------------------------------------------------------------------

export function truncatePreview(input: string, max: number): string {
  if (input.length <= max) {
    return input;
  }
  return input.slice(0, max) + '...';
}

// ---------------------------------------------------------------------------
// Command execution
// ---------------------------------------------------------------------------

export function gitOutput(repoPath: string, args: string[]): string {
  const result = spawnSync('git', ['-C', repoPath, ...args], {
    encoding: 'utf-8',
    stdio: ['pipe', 'pipe', 'pipe'],
    shell: process.platform === 'win32',
  });
  if (result.status !== 0) {
    return '';
  }
  return result.stdout;
}

export function execGit(
  repoPath: string,
  args: string[],
): { stdout: string; stderr: string; success: boolean } {
  const result = spawnSync('git', ['-C', repoPath, ...args], {
    encoding: 'utf-8',
    stdio: ['pipe', 'pipe', 'pipe'],
    shell: process.platform === 'win32',
  });
  return {
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
    success: result.status === 0,
  };
}

export function execCommand(
  bin: string,
  args: string[],
  options?: { cwd?: string },
): { stdout: string; stderr: string; success: boolean } {
  const result = spawnSync(bin, args, {
    encoding: 'utf-8',
    cwd: options?.cwd,
    stdio: ['pipe', 'pipe', 'pipe'],
    shell: process.platform === 'win32',
  });
  return {
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
    success: result.status === 0,
  };
}

export function collectConflictFiles(repoPath: string): string[] {
  const result = execGit(repoPath, ['diff', '--name-only', '--diff-filter=U']);
  if (!result.success) {
    return [];
  }
  return result.stdout
    .split('\n')
    .filter((l) => l.trim().length > 0);
}

export function isStructuredCliEvent(line: string): boolean {
  try {
    const v = JSON.parse(line);
    return typeof v.type === 'string';
  } catch {
    return false;
  }
}
