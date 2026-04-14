import { ApiError } from '../errors.js';
import {
  applyBranchToBaseUnstaged,
  applyMergeNoFf,
  applyRebase,
  applyWorktreeToBaseUnstaged,
  detectBaseBranchWithDefault,
  ghCreatePr,
  gitCommitAll,
  gitPush,
  hasGhCli,
} from '../executor/index.js';
import { execGit } from '../executor/shell.js';
import { broadcastGlobalEvent } from '../websocket.js';
import type { Repo, Run, TaskWithPayload } from '../models.js';
import type { AppState } from '../state.js';

export interface ApplyToMainPayload {
  autoCommit?: boolean;
  commitMessage?: string;
  strategy?: string;
}

// -- Helper to resolve task, run, and repo --

export function resolveTaskRunRepo(
  state: AppState,
  taskId: string,
): { task: TaskWithPayload; run: Run; repo: Repo } {
  const task = state.db.getTaskById(taskId);
  if (!task) {
    throw ApiError.notFound('Task not found.');
  }

  const run = state.db.getLatestRunByTask(taskId);
  if (!run) {
    throw ApiError.badRequest('No run found for this task.');
  }

  const repo = state.db.getRepoById(task.repo_id);
  if (!repo) {
    throw ApiError.notFound('Repo not found.');
  }

  return { task, run, repo };
}

// -- Apply changes to main branch --

export function applyToMain(
  state: AppState,
  taskId: string,
  payload: ApplyToMainPayload,
): any {
  const autoCommit = payload.autoCommit ?? false;
  const commitMessage = payload.commitMessage;
  const strategy = payload.strategy ?? 'squash';

  const task = state.db.getTaskById(taskId);
  if (!task) {
    throw ApiError.notFound('Task not found.');
  }

  // Prevent apply while an agent is actively running in the worktree
  const activeRun = state.db.getLatestRunByTask(taskId);
  if (activeRun?.status === 'running') {
    throw ApiError.badRequest('Cannot apply while an agent run is active. Cancel the run first.');
  }

  if (!task.use_worktree) {
    return {
      applied: true,
      filesChanged: 0,
      baseBranch: 'current',
      directMode: true,
    };
  }

  const run = state.db.getLatestRunByTask(taskId);
  if (!run) {
    throw ApiError.badRequest('No run found for this task.');
  }

  const repo = state.db.getRepoById(task.repo_id);
  if (!repo) {
    throw ApiError.notFound('Repo not found.');
  }

  const baseBranch = detectBaseBranchWithDefault(repo.path, repo.default_branch);

  let applyResult;
  switch (strategy) {
    case 'merge':
      applyResult = applyMergeNoFf(repo.path, run.branch_name, baseBranch, run.worktree_path ?? undefined);
      break;
    case 'rebase':
      applyResult = applyRebase(repo.path, run.branch_name, baseBranch, run.worktree_path ?? undefined);
      break;
    default: {
      if (run.worktree_path) {
        applyResult = applyWorktreeToBaseUnstaged(
          repo.path,
          run.branch_name,
          baseBranch,
          run.worktree_path,
        );
      } else {
        applyResult = applyBranchToBaseUnstaged(repo.path, run.branch_name, baseBranch);
      }
      break;
    }
  }

  if (applyResult.ok) {
    let committed = false;
    if (autoCommit && applyResult.result.filesChanged > 0) {
      const msg = commitMessage ?? `feat(${task.jira_issue_key}): ${task.title}`;
      gitCommitAll(repo.path, msg);
      committed = true;
    }

    // Reset worktree branch to base for clean followup work
    if (run.worktree_path) {
      const wtCheck = execGit(run.worktree_path, ['rev-parse', '--git-dir']);
      if (wtCheck.success) {
        execGit(run.worktree_path, ['reset', '--hard', baseBranch]);
      }
    }

    // Broadcast task_applied to all global WS subscribers
    broadcastGlobalEvent({
      type: 'task_applied',
      taskId,
      strategy,
      committed,
      filesChanged: applyResult.result.filesChanged,
    });

    return {
      applied: true,
      filesChanged: applyResult.result.filesChanged,
      baseBranch: applyResult.result.baseBranch,
      committed,
      strategy,
    };
  }

  if ('conflict' in applyResult && applyResult.conflict) {
    return {
      conflict: true,
      conflictedFiles: applyResult.conflict.conflictedFiles,
    };
  }

  if ('error' in applyResult) {
    throw ApiError.internal(new Error(applyResult.error));
  }

  throw ApiError.internal(new Error('Unknown apply error'));
}

// -- Push branch --

export function pushBranch(
  state: AppState,
  taskId: string,
): { pushed: boolean; branch: string } {
  const { run, repo } = resolveTaskRunRepo(state, taskId);

  if (!run.branch_name) {
    throw ApiError.badRequest('No branch to push (direct mode).');
  }

  const pushPath = run.worktree_path ?? repo.path;
  gitPush(pushPath, run.branch_name);

  return { pushed: true, branch: run.branch_name };
}

// -- Create pull request --

export function createPr(
  state: AppState,
  taskId: string,
): { prUrl: string; prNumber: number | null; branch: string } {
  if (!hasGhCli()) {
    throw ApiError.badRequest('GitHub CLI (gh) is not installed.');
  }

  const { task, run, repo } = resolveTaskRunRepo(state, taskId);

  if (!run.branch_name) {
    throw ApiError.badRequest('No branch for PR (direct mode).');
  }

  const baseBranch = detectBaseBranchWithDefault(repo.path, repo.default_branch);

  const pushPath = run.worktree_path ?? repo.path;
  gitPush(pushPath, run.branch_name);

  const title = `${task.jira_issue_key}: ${task.title}`;
  const body = task.description ?? '';

  const prUrl = ghCreatePr(repo.path, title, body, baseBranch);

  const parsedPrNumber = parseInt(prUrl.split('/').pop() ?? '', 10);
  const prNumber = isNaN(parsedPrNumber) ? undefined : parsedPrNumber;

  state.db.updateTaskPr(task.id, prUrl, prNumber);

  return {
    prUrl,
    prNumber: prNumber ?? null,
    branch: run.branch_name,
  };
}
