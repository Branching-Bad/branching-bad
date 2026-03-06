import { spawnSync } from 'child_process';
import type { Db } from '../db/index.js';
import type { MsgStore } from '../msgStore.js';

const MAX_BUILD_OUTPUT = 4000;

export interface BuildResult {
  success: boolean;
  output: string;
  exitCode: number | null;
}

/**
 * Run the repo's build_command in the given working directory.
 * Returns null if the repo has no build_command configured.
 */
export function runBuildCommand(
  db: Db,
  repoId: string,
  workingDir: string,
  store: MsgStore | undefined,
): BuildResult | null {
  const repo = db.getRepoById(repoId);
  if (!repo?.build_command) return null;

  store?.push({ type: 'stdout', data: `[build] Running: ${repo.build_command}` });

  const result = spawnSync(repo.build_command, {
    cwd: workingDir,
    shell: true,
    timeout: 120_000,
    maxBuffer: 10 * 1024 * 1024,
    encoding: 'utf8',
  });

  const output = ((result.stdout ?? '') + (result.stderr ?? '')).slice(-MAX_BUILD_OUTPUT);
  const success = result.status === 0;

  if (success) {
    store?.push({ type: 'stdout', data: '[build] Build passed' });
  } else {
    store?.push({ type: 'stderr', data: `[build] Build failed (exit ${result.status})` });
    if (output.trim()) {
      store?.push({ type: 'stderr', data: output.trim() });
    }
  }

  return { success, output, exitCode: result.status };
}
