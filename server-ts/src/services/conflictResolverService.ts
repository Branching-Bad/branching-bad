// ---------------------------------------------------------------------------
// Conflict resolver service — spawns an agent to resolve git merge conflicts
// ---------------------------------------------------------------------------

import { existsSync } from 'fs';
import { MsgStore } from '../msgStore.js';
import { detectBaseBranchWithDefault, getHeadSha } from '../executor/index.js';
import type { AppState } from '../state.js';
import { buildAgentCommand, persistStoreOutputs, resolveAgentProfile } from '../routes/shared.js';
import { broadcastGlobalEvent } from '../websocket.js';
import { spawnResumeRun } from './agentSpawner.js';

function buildConflictPrompt(
  conflictedFiles: string[],
  taskBranch: string,
  baseBranch: string,
): string {
  const fileList = conflictedFiles.map((f) => `- ${f}`).join('\n');

  return [
    `Merge conflicts while merging branch '${taskBranch}' into '${baseBranch}'.`,
    '',
    `Files with conflicts:`,
    fileList,
    '',
    `The branch '${taskBranch}' contains the intended changes. Run \`git diff ${baseBranch}...${taskBranch}\` to see what needs to be applied.`,
    '',
    'Instructions:',
    '1. Read each conflicted file in the working tree',
    '2. Compare with the version on the task branch to understand intended changes',
    '3. If the file has conflict markers (<<<<<<< ======= >>>>>>>), resolve them preserving both sides',
    '4. If the file has no conflict markers, apply the intended changes from the task branch manually',
    '5. Do NOT run git add or git commit — leave files as unstaged changes',
    '6. Do NOT delete the task branch or modify any other files',
  ].join('\n');
}

export async function resolveConflicts(
  state: AppState,
  repo: { id: string; path: string },
  task: { id: string; repo_id: string; title: string; agent_profile_id: string | null },
  conflictedFiles: string[],
): Promise<{ runId: string }> {
  const latestRun = state.db.getLatestRunByTask(task.id);
  const branchName = latestRun?.branch_name ?? '';
  const baseSha = latestRun?.base_sha ?? (getHeadSha(repo.path) ?? null);

  // After apply-to-main, worktree+branch are deleted — conflicts are in repo.path.
  // Only use worktree path if it actually still exists on disk.
  const worktreePath = latestRun?.worktree_path ?? undefined;
  const worktreeExists = worktreePath ? existsSync(worktreePath) : false;
  const effectiveWorktreePath = worktreeExists ? worktreePath : undefined;

  const profile = resolveAgentProfile(state, undefined, task as any);
  const agentCommand = buildAgentCommand(profile);

  const run = state.db.createRun(
    task.id,
    latestRun?.plan_id ?? null,
    'running',
    branchName,
    profile.id,
    effectiveWorktreePath,
    baseSha ?? undefined,
  );

  // No status change — conflict resolution runs in whatever status the task is in

  state.db.addRunEvent(run.id, 'run_started', {
    branchName,
    conflictResolution: true,
    conflictedFiles,
    agentProfile: {
      id: profile.id,
      provider: profile.provider,
      agentName: profile.agent_name,
      model: profile.model,
      command: agentCommand,
    },
  });

  broadcastGlobalEvent({
    type: 'run_started',
    runId: run.id,
    taskId: task.id,
    repoId: repo.id,
    taskTitle: task.title,
  });

  const store = new MsgStore();
  state.processManager.registerStore(run.id, store);
  persistStoreOutputs(store, state.db, task.id);

  const baseBranch = detectBaseBranchWithDefault(repo.path, state.db.getRepoById(repo.id)?.default_branch);
  const prompt = buildConflictPrompt(conflictedFiles, branchName, baseBranch);
  const agentWorkingDir = effectiveWorktreePath ?? repo.path;

  setImmediate(() => {
    store.push({ type: 'agent_text', data: 'Starting conflict resolution agent...' });
    spawnResumeRun(
      agentCommand,
      prompt,
      agentWorkingDir,
      null,
      run.id,
      task.id,
      repo.path,
      baseSha,
      state.db,
      state.processManager,
      store,
      { command: agentCommand, isConflictResolution: true },
    );
  });

  return { runId: run.id };
}
