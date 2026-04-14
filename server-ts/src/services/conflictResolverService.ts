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
    `Merge conflict markers are in the working tree of '${baseBranch}' (the current directory).`,
    `The task branch '${taskBranch}' holds the intended task changes.`,
    '',
    'Conflicted files (current working directory):',
    fileList,
    '',
    'Each marker block has this shape (labels are literal in the file):',
    `  <<<<<<< main       — content already present in ${baseBranch}'s working tree (existing work to keep)`,
    '  ||||||| ancestor   — the common ancestor (may be absent; ignore if not shown)',
    `  >>>>>>> task       — content the task ('${taskBranch}') wants to introduce`,
    '',
    'HARD RULES:',
    '1. For every conflicted file, produce ONE coherent version that contains the UNION of both sides:',
    '   keep the existing work AND apply the task change. Merge them into valid, compiling source.',
    '2. The final file content must be PURE SOURCE CODE only. It MUST NOT contain any of these tokens',
    '   anywhere in the file, not even in comments or strings:',
    '     `<<<<<<<`   `=======`   `|||||||`   `>>>>>>>`',
    '   If you output a file that still contains any of these, the merge is considered FAILED.',
    '3. Do not add commentary, explanation, TODO notes, or markdown. Write code exactly as it would',
    '   appear in a clean source file — nothing above, below, or inside the file that is not real code.',
    '4. Leave files UNSTAGED. Do NOT run `git add`, `git commit`, `git merge`, `git stash`, or any',
    '   git command that rewrites history, staging, or branches.',
    '5. Do not touch any file that is not in the list above.',
    '',
    'Self-check before finishing: for each file you edited, confirm zero occurrences of `<<<<<<<`,',
    '`=======`, `|||||||`, or `>>>>>>>`. If any remain, fix them before exiting.',
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

  // Conflict markers from applyWorktreeToBaseUnstaged live in the main repo's
  // working tree, so the agent resolves there. The worktree path is still
  // recorded on the run (so Done-flow cleanup finds it later) but the agent
  // does NOT cd into it.
  const worktreePath = latestRun?.worktree_path ?? undefined;
  const worktreeExists = worktreePath ? existsSync(worktreePath) : false;
  const recordedWorktreePath = worktreeExists ? worktreePath : undefined;

  const profile = resolveAgentProfile(state, undefined, task as any);
  const agentCommand = buildAgentCommand(profile);

  const run = state.db.createRun(
    task.id,
    latestRun?.plan_id ?? null,
    'running',
    branchName,
    profile.id,
    recordedWorktreePath,
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
  const agentWorkingDir = repo.path;

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
