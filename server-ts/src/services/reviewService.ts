import fs from 'fs';
import { v4 as uuidv4 } from 'uuid';

import { ApiError } from '../errors.js';
import { MsgStore } from '../msgStore.js';
import type { AppState } from '../state.js';
import {
  buildAgentCommand,
  loadRulesSection,
  resolveAgentProfile,
} from '../routes/shared.js';
import { applyDirtyStateToWorktree, createWorktree } from '../executor/index.js';
import { spawnResumeRun } from './agentSpawner.js';
import { cleanStaleRuns } from './staleRunCleaner.js';

/**
 * Ensure the agent has a valid worktree to work in.
 * If the original worktree still exists, reuse it.
 * If it was removed (e.g. after apply-to-main), recreate it.
 * For direct-mode tasks (no worktree), return repo root.
 */
function ensureWorkingDir(
  worktreePath: string | null | undefined,
  branchName: string | null | undefined,
  repoPath: string,
  carryDirtyState?: boolean,
): string {
  if (!worktreePath || !branchName) return repoPath;
  if (fs.existsSync(worktreePath)) {
    if (carryDirtyState) {
      applyDirtyStateToWorktree(repoPath, worktreePath);
    }
    return worktreePath;
  }
  // Worktree was removed (apply-to-main) — recreate it
  const wt = createWorktree(repoPath, branchName, { carryDirtyState });
  return wt.worktreePath;
}

// -- Payload types --

export interface LineCommentPayload {
  filePath: string;
  lineStart: number;
  lineEnd: number;
  diffHunk: string;
  text: string;
}

export interface SubmitReviewPayload {
  comment?: string;
  profileId?: string;
  mode?: string;
  lineComments?: LineCommentPayload[];
  carryDirtyState?: boolean;
}

// -- Submit review and spawn feedback run --

export function submitReview(
  state: AppState,
  taskId: string,
  payload: SubmitReviewPayload,
): { reviewComment: any; run: { id: string; status: string } } {
  const commentText = (payload.comment ?? '').trim();
  const lineComments = payload.lineComments ?? [];
  const reviewMode = payload.mode ?? 'instant';

  if (!commentText && lineComments.length === 0) {
    throw ApiError.badRequest('Comment or line comments required.');
  }

  const task = state.db.getTaskById(taskId);
  if (!task) {
    throw ApiError.notFound('Task not found.');
  }

  if (task.status !== 'IN_REVIEW') {
    throw ApiError.badRequest('Task must be in IN_REVIEW status to submit feedback.');
  }

  const latestRun = state.db.getLatestRunByTask(taskId);
  if (!latestRun) {
    throw ApiError.notFound('No completed run found for this task.');
  }

  const repo = state.db.getRepoById(task.repo_id);
  if (!repo) {
    throw ApiError.notFound('Repo not found.');
  }

  cleanStaleRuns(state, repo.id);

  const batchId =
    reviewMode === 'batch' && lineComments.length > 0 ? uuidv4() : undefined;

  const storedLineComments = lineComments.map((lc) =>
    state.db.addReviewCommentFull(
      task.id,
      latestRun.id,
      lc.text,
      lc.filePath,
      lc.lineStart,
      lc.lineEnd,
      lc.diffHunk,
      reviewMode,
      batchId,
    ),
  );

  const reviewComment = commentText
    ? state.db.addReviewCommentFull(
        task.id,
        latestRun.id,
        commentText,
        undefined,
        undefined,
        undefined,
        undefined,
        reviewMode,
        batchId,
      )
    : null;

  for (const rc of storedLineComments) {
    state.db.updateReviewCommentStatus(rc.id, 'processing');
  }
  if (reviewComment) {
    state.db.updateReviewCommentStatus(reviewComment.id, 'processing');
  }

  const primaryComment = reviewComment ?? storedLineComments[0];
  if (!primaryComment) {
    throw ApiError.badRequest('No comments to submit.');
  }

  const profile = resolveAgentProfile(state, payload.profileId, task);
  const agentCommand = buildAgentCommand(profile);

  const run = state.db.createRun(
    task.id,
    latestRun.plan_id,
    'running',
    latestRun.branch_name,
    profile.id,
    latestRun.worktree_path ?? undefined,
    latestRun.base_sha ?? undefined,
  );

  state.db.updateRunReviewCommentId(run.id, primaryComment.id);

  for (const rc of storedLineComments) {
    state.db.updateReviewCommentStatus(rc.id, 'processing', run.id);
  }
  if (reviewComment) {
    state.db.updateReviewCommentStatus(reviewComment.id, 'processing', run.id);
  }

  const rulesSection = loadRulesSection(state.db, task.repo_id);
  const prompt = buildReviewPrompt(lineComments, commentText, rulesSection);
  // Only resume session from successful runs — failed runs may have stale/invalid sessions
  const sessionId = latestRun.status === 'done' ? latestRun.agent_session_id : null;
  const baseSha = latestRun.base_sha;
  const store = new MsgStore();
  state.processManager.registerStore(run.id, store);

  setImmediate(async () => {
    let agentWorkingDir: string;
    try {
      agentWorkingDir = ensureWorkingDir(latestRun.worktree_path, latestRun.branch_name, repo.path, payload.carryDirtyState);
      if (agentWorkingDir !== repo.path) {
        state.db.updateRunWorktreePath(run.id, agentWorkingDir);
      }
    } catch (e) {
      store.pushStderr(`Failed to prepare worktree: ${e}`);
      store.pushFinished(null, 'failed');
      state.db.updateRunStatus(run.id, 'failed', true);
      return;
    }

    store.push({ type: 'agent_text', data: 'Starting review feedback run...' });
    await spawnResumeRun(
      agentCommand,
      prompt,
      agentWorkingDir,
      sessionId,
      run.id,
      task.id,
      repo.path,
      baseSha,
      state.db,
      state.processManager,
      store,
      { command: agentCommand, isReviewRun: true },
    );
  });

  return {
    reviewComment: primaryComment,
    run: { id: run.id, status: run.status },
  };
}

// -- Re-send an existing review comment --

export function resendReview(
  state: AppState,
  taskId: string,
  commentId: string,
  profileId?: string,
): { reviewComment: any; run: { id: string; status: string } } {
  const rc = state.db.getReviewCommentById(commentId);
  if (!rc) throw ApiError.notFound('Review comment not found.');
  if (rc.task_id !== taskId) throw ApiError.badRequest('Comment does not belong to this task.');
  if (rc.status === 'addressed') throw ApiError.badRequest('Cannot re-send an addressed comment.');

  const task = state.db.getTaskById(taskId);
  if (!task) throw ApiError.notFound('Task not found.');
  if (task.status !== 'IN_REVIEW') throw ApiError.badRequest('Task must be in IN_REVIEW status.');

  const latestRun = state.db.getLatestRunByTask(taskId);
  if (!latestRun) throw ApiError.notFound('No completed run found.');

  const repo = state.db.getRepoById(task.repo_id);
  if (!repo) throw ApiError.notFound('Repo not found.');

  cleanStaleRuns(state, repo.id);

  state.db.updateReviewCommentStatus(rc.id, 'processing');

  const profile = resolveAgentProfile(state, profileId, task);
  const agentCommand = buildAgentCommand(profile);

  const run = state.db.createRun(
    task.id,
    latestRun.plan_id,
    'running',
    latestRun.branch_name,
    profile.id,
    latestRun.worktree_path ?? undefined,
    latestRun.base_sha ?? undefined,
  );

  state.db.updateRunReviewCommentId(run.id, rc.id);
  state.db.updateReviewCommentStatus(rc.id, 'processing', run.id);

  const lineComments: LineCommentPayload[] = rc.file_path
    ? [{ filePath: rc.file_path, lineStart: rc.line_start!, lineEnd: rc.line_end!, diffHunk: rc.diff_hunk!, text: rc.comment }]
    : [];
  const commentText = rc.file_path ? '' : rc.comment;

  const rulesSection = loadRulesSection(state.db, task.repo_id);
  const prompt = buildReviewPrompt(lineComments, commentText, rulesSection);
  const sessionId = latestRun.status === 'done' ? latestRun.agent_session_id : null;
  const baseSha = latestRun.base_sha;
  const store = new MsgStore();
  state.processManager.registerStore(run.id, store);

  setImmediate(async () => {
    let agentWorkingDir: string;
    try {
      agentWorkingDir = ensureWorkingDir(latestRun.worktree_path, latestRun.branch_name, repo.path, task.carry_dirty_state);
      if (agentWorkingDir !== repo.path) {
        state.db.updateRunWorktreePath(run.id, agentWorkingDir);
      }
    } catch (e) {
      store.pushStderr(`Failed to prepare worktree: ${e}`);
      store.pushFinished(null, 'failed');
      state.db.updateRunStatus(run.id, 'failed', true);
      return;
    }

    store.push({ type: 'agent_text', data: 'Re-sending review feedback...' });
    await spawnResumeRun(
      agentCommand, prompt, agentWorkingDir, sessionId,
      run.id, task.id, repo.path, baseSha,
      state.db, state.processManager, store,
      { command: agentCommand, isReviewRun: true },
    );
  });

  return { reviewComment: rc, run: { id: run.id, status: run.status } };
}

// -- Build the review feedback prompt --

function buildReviewPrompt(
  lineComments: LineCommentPayload[],
  commentText: string,
  rulesSection: string,
): string {
  const parts: string[] = ['Review feedback on previous work:\n'];

  // Group comments by file+diffHunk to avoid sending the same hunk multiple times
  const grouped = new Map<
    string,
    { filePath: string; diffHunk: string; comments: { lineStart: number; lineEnd: number; text: string }[] }
  >();
  for (const lc of lineComments) {
    const key = `${lc.filePath}::${lc.diffHunk}`;
    if (!grouped.has(key)) {
      grouped.set(key, { filePath: lc.filePath, diffHunk: lc.diffHunk, comments: [] });
    }
    grouped.get(key)!.comments.push({ lineStart: lc.lineStart, lineEnd: lc.lineEnd, text: lc.text });
  }

  for (const { filePath, diffHunk, comments } of grouped.values()) {
    parts.push(`## File: ${filePath}`);
    parts.push(`\`\`\`\n${diffHunk}\n\`\`\``);
    for (const c of comments) {
      const lineRange =
        c.lineStart === c.lineEnd
          ? `Line ${c.lineStart}`
          : `Lines ${c.lineStart}-${c.lineEnd}`;
      parts.push(`> (${lineRange}) ${c.text}`);
    }
    parts.push('');
  }

  if (commentText) {
    if (lineComments.length > 0) {
      parts.push('## General feedback');
    }
    parts.push(commentText);
  }

  parts.push('\nPlease address this feedback and make the necessary changes.');
  if (rulesSection) {
    parts.push(rulesSection);
  }

  return parts.join('\n');
}
