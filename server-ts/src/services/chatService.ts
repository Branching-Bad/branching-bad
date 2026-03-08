import fs from 'fs';
import { ApiError } from '../errors.js';
import type { ChatMessage } from '../models.js';
import type { AppState } from '../state.js';
import {
  buildAgentCommand,
  loadRulesSection,
  resolveAgentProfile,
} from '../routes/shared.js';
import { spawnChatFollowUp } from './chatSpawner.js';

// -- Send chat message and optionally spawn follow-up run --

export interface SendChatResult {
  chatMessage: ChatMessage;
  run: { id: string; status: string; branch_name: string } | null;
}

export function sendChatMessage(
  state: AppState,
  taskId: string,
  content: string,
  profileId?: string,
): SendChatResult {
  const task = state.db.getTaskById(taskId);
  if (!task) {
    throw ApiError.notFound('Task not found.');
  }

  let chatMsg = state.db.insertChatMessage(task.id, 'user', content, 'sent');

  const isRunning = state.db.hasRunningRunForTask(task.id);
  if (isRunning) {
    state.db.updateChatMessageStatus(chatMsg.id, 'queued');
    chatMsg.status = 'queued';
    return { chatMessage: chatMsg, run: null };
  }

  const latestRun = state.db.getLatestRunByTask(task.id);
  if (!latestRun) {
    throw ApiError.badRequest('No previous run found to follow up on.');
  }

  const repo = state.db.getRepoById(task.repo_id);
  if (!repo) {
    throw ApiError.notFound('Repo not found.');
  }

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

  state.db.updateRunChatMessageId(run.id, chatMsg.id);
  state.db.updateChatMessageStatus(chatMsg.id, 'dispatched', run.id);
  chatMsg.status = 'dispatched';
  chatMsg.result_run_id = run.id;

  state.db.updateTaskStatus(task.id, 'IN_PROGRESS');

  const rulesSection = loadRulesSection(state.db, task.repo_id);
  const promptWithRules = content + rulesSection;

  spawnChatFollowUp(state, {
    agentCommand,
    prompt: promptWithRules,
    displayContent: content,
    agentWorkingDir: (latestRun.worktree_path && fs.existsSync(latestRun.worktree_path)) ? latestRun.worktree_path : repo.path,
    sessionId: latestRun.status === 'done' ? latestRun.agent_session_id : null,
    baseSha: latestRun.base_sha,
    runId: run.id,
    taskId: task.id,
    repoPath: repo.path,
    startMessage: 'Starting follow-up run...',
  });

  return {
    chatMessage: chatMsg,
    run: { id: run.id, status: run.status, branch_name: run.branch_name },
  };
}

// -- Dispatch next queued chat message --

export interface DispatchNextResult {
  dispatched: boolean;
  reason?: string;
  chatMessage?: ChatMessage;
  run?: { id: string; status: string; branch_name: string };
}

export function dispatchNextQueuedChat(
  state: AppState,
  taskId: string,
): DispatchNextResult {
  const isRunning = state.db.hasRunningRunForTask(taskId);
  if (isRunning) {
    return { dispatched: false, reason: 'run_active' };
  }

  const chatMsg = state.db.getNextQueuedChatMessage(taskId);
  if (!chatMsg) {
    return { dispatched: false, reason: 'no_queued' };
  }

  const task = state.db.getTaskById(taskId);
  if (!task) {
    throw ApiError.notFound('Task not found.');
  }

  const latestRun = state.db.getLatestRunByTask(task.id);
  if (!latestRun) {
    throw ApiError.badRequest('No previous run found.');
  }

  const repo = state.db.getRepoById(task.repo_id);
  if (!repo) {
    throw ApiError.notFound('Repo not found.');
  }

  const profile = resolveAgentProfile(state, undefined, task);
  const agentCommand = buildAgentCommand(profile);
  const content = chatMsg.content;

  const run = state.db.createRun(
    task.id,
    latestRun.plan_id,
    'running',
    latestRun.branch_name,
    profile.id,
    latestRun.worktree_path ?? undefined,
    latestRun.base_sha ?? undefined,
  );

  state.db.updateRunChatMessageId(run.id, chatMsg.id);
  state.db.updateChatMessageStatus(chatMsg.id, 'dispatched', run.id);
  state.db.updateTaskStatus(task.id, 'IN_PROGRESS');

  const rulesSection = loadRulesSection(state.db, task.repo_id);
  const promptWithRules = content + rulesSection;

  spawnChatFollowUp(state, {
    agentCommand,
    prompt: promptWithRules,
    displayContent: content,
    agentWorkingDir: (latestRun.worktree_path && fs.existsSync(latestRun.worktree_path)) ? latestRun.worktree_path : repo.path,
    sessionId: latestRun.status === 'done' ? latestRun.agent_session_id : null,
    baseSha: latestRun.base_sha,
    runId: run.id,
    taskId: task.id,
    repoPath: repo.path,
    startMessage: 'Dispatching queued follow-up...',
  });

  return {
    dispatched: true,
    chatMessage: chatMsg,
    run: { id: run.id, status: run.status, branch_name: run.branch_name },
  };
}
