import { v4 as uuidv4 } from 'uuid';

import { ApiError } from '../errors.js';
import { MsgStore } from '../msgStore.js';
import type { AppState } from '../state.js';
import {
  buildAgentCommand,
  loadRulesSection,
  resolveAgentProfile,
} from '../routes/shared.js';
import { spawnResumeRun } from './agentSpawner.js';

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

  if (state.db.hasRunningRunForRepo(repo.id)) {
    throw ApiError.conflict('Another run is already active for this repository.');
  }

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
  const agentWorkingDir = latestRun.worktree_path ?? repo.path;
  const sessionId = latestRun.agent_session_id;
  const baseSha = latestRun.base_sha;
  const store = new MsgStore();
  state.processManager.registerStore(run.id, store);

  setImmediate(async () => {
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
