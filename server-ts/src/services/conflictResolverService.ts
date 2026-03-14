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
    `The branch '${taskBranch}' contains the intended changes. The working tree (${baseBranch}) may also have uncommitted changes that MUST be preserved.`,
    '',
    'Instructions:',
    '1. For each conflicted file, read THREE versions:',
    `   a. The current working tree version (may have uncommitted changes from previous work)`,
    `   b. The committed version: \`git show ${baseBranch}:<file>\``,
    `   c. The task branch version: \`git show ${taskBranch}:<file>\``,
    '2. The final result MUST include ALL of the following:',
    `   a. Everything in the committed ${baseBranch} version (the base)`,
    '   b. All uncommitted changes already in the working tree (preserve existing dirty state)',
    `   c. All changes from ${taskBranch} that are not yet in the working tree`,
    '3. If the file has conflict markers (<<<<<<< ======= >>>>>>>), resolve them by merging both sides',
    '4. Write the merged result to the working tree file',
    '5. Do NOT run git add or git commit — leave files as unstaged changes',
    '6. Do NOT delete the task branch or modify any other files',
    '',
    'CRITICAL: Never discard uncommitted working tree changes. They represent previously applied work that has not been committed yet.',
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
