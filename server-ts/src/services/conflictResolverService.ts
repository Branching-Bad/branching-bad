// ---------------------------------------------------------------------------
// Conflict resolver service — spawns an agent to resolve git merge conflicts
// ---------------------------------------------------------------------------

import { MsgStore } from '../msgStore.js';
import { getHeadSha } from '../executor/index.js';
import type { AppState } from '../state.js';
import { buildAgentCommand, persistStoreOutputs, resolveAgentProfile } from '../routes/shared.js';
import { broadcastGlobalEvent } from '../websocket.js';
import { spawnResumeRun } from './agentSpawner.js';

function buildConflictPrompt(conflictedFiles: string[]): string {
  const fileList = conflictedFiles.map((f) => `  - ${f}`).join('\n');
  return [
    'You are resolving git merge conflicts. The following files have conflict markers:\n',
    fileList,
    '\nRules:',
    '1. Open each conflicted file and resolve the conflicts',
    '2. PRESERVE changes from BOTH sides — both branches contain critical work',
    '3. Remove all conflict markers: <<<<<<<, =======, >>>>>>>',
    '4. Produce the correct merged result that incorporates both sides\' intent',
    '5. Do NOT run git add or git commit — leave files as unstaged changes',
    '6. If a conflict is ambiguous, prefer including both changes rather than losing either',
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
  const worktreePath = latestRun?.worktree_path ?? undefined;
  const baseSha = latestRun?.base_sha ?? (getHeadSha(repo.path) ?? null);

  const profile = resolveAgentProfile(state, undefined, task as any);
  const agentCommand = buildAgentCommand(profile);

  const run = state.db.createRun(
    task.id,
    latestRun?.plan_id ?? null,
    'running',
    branchName,
    profile.id,
    worktreePath,
    baseSha ?? undefined,
  );

  state.db.updateTaskStatus(task.id, 'IN_PROGRESS');

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

  const prompt = buildConflictPrompt(conflictedFiles);
  const agentWorkingDir = worktreePath ?? repo.path;

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
