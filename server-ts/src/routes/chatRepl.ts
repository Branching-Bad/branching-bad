import { Router, type Request, type Response, type NextFunction } from 'express';
import { randomUUID } from 'crypto';
import treeKill from 'tree-kill';
import type { ChildProcess } from 'child_process';

import type { AppState } from '../state.js';
import { ApiError } from '../errors.js';
import { MsgStore } from '../msgStore.js';
import { spawnAgent } from '../executor/agent.js';
import { buildAgentCommand } from './shared.js';
import { buildChatPrompt, summariseChatSession } from '../services/chatReplService.js';

// ---------------------------------------------------------------------------
// In-memory live session registry (mirrors analyst pattern)
// ---------------------------------------------------------------------------

interface LiveSession {
  id: string;
  store: MsgStore;
  child: ChildProcess | null;
  idle: boolean;
  lastLogIndex: number;
}

const liveSessions = new Map<string, LiveSession>();

export function getChatReplStore(sessionId: string, state?: AppState): MsgStore | undefined {
  const existing = liveSessions.get(sessionId);
  if (existing) return existing.store;
  if (!state) return undefined;

  const dbSession = state.db.getChatSession(sessionId);
  if (!dbSession) return undefined;

  const store = new MsgStore();
  const savedLogs = state.db.getChatLogs(sessionId);
  for (const log of savedLogs) {
    store.push({ type: log.type as 'stdout', data: log.data });
  }
  if (dbSession.agent_session_id) store.setSessionId(dbSession.agent_session_id);

  const session: LiveSession = {
    id: sessionId, store, child: null, idle: true,
    lastLogIndex: savedLogs.length,
  };
  liveSessions.set(sessionId, session);
  return store;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function monitorChild(session: LiveSession, child: ChildProcess): void {
  session.child = child;
  session.idle = false;
  child.on('exit', () => {
    session.idle = true;
    session.child = null;
    session.store.push({ type: 'agent_done', data: '' });
  });
}

function killChild(session: LiveSession): Promise<void> {
  const child = session.child;
  if (!child || child.pid == null) return Promise.resolve();
  return new Promise((resolve) => {
    treeKill(child.pid!, 'SIGTERM', () => { session.child = null; resolve(); });
  });
}

function flushLogs(state: AppState, session: LiveSession): void {
  const allLogs = session.store.getHistory();
  const newLogs = allLogs.slice(session.lastLogIndex);
  if (newLogs.length === 0) return;
  state.db.appendChatLogs(session.id, newLogs);
  session.lastLogIndex = allLogs.length;
}

function syncAgentSessionId(state: AppState, session: LiveSession): void {
  const agentSid = session.store.getSessionId();
  if (agentSid) state.db.updateChatSession(session.id, { agent_session_id: agentSid });
}

function wrap(fn: (req: Request, res: Response) => Promise<void>) {
  return (req: Request, res: Response, next: NextFunction) => {
    fn(req, res).catch(next);
  };
}

async function waitUntilIdle(session: LiveSession): Promise<void> {
  if (!session.child || session.idle) return;
  return new Promise((resolve) => {
    const tick = () => {
      if (session.idle || !session.child) { resolve(); return; }
      setTimeout(tick, 200);
    };
    tick();
  });
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

export function chatReplRoutes(): Router {
  const router = Router();

  // POST /api/repos/:repo_id/chat/start
  router.post('/api/repos/:repo_id/chat/start', wrap(async (req, res) => {
    const state = req.app.locals.state as AppState;
    const repoId = String(req.params.repo_id);
    const { message, profileId } = req.body as { message?: string; profileId?: string };

    if (!message?.trim()) throw ApiError.badRequest('message is required');
    if (!profileId?.trim()) throw ApiError.badRequest('profileId is required');

    const repo = state.db.getRepoById(repoId);
    if (!repo) throw ApiError.notFound('Repo not found');

    const profile = state.db.getAgentProfileById(profileId);
    if (!profile) throw ApiError.notFound('Agent profile not found');

    const agentCommand = buildAgentCommand(profile);
    if (!agentCommand.trim()) throw ApiError.badRequest('Agent profile has no command');

    const sessionId = randomUUID();
    state.db.createChatSession(sessionId, repoId, profileId, message);

    const store = new MsgStore();
    store.push({ type: 'user_message', data: message });

    const session: LiveSession = { id: sessionId, store, child: null, idle: false, lastLogIndex: 0 };
    liveSessions.set(sessionId, session);

    const prompt = buildChatPrompt(state.db, repoId, message);
    const child = spawnAgent(agentCommand, prompt, repo.path, store);
    monitorChild(session, child);

    const flushInterval = setInterval(() => {
      flushLogs(state, session);
      syncAgentSessionId(state, session);
    }, 2000);
    child.on('exit', () => {
      clearInterval(flushInterval);
      flushLogs(state, session);
      syncAgentSessionId(state, session);
    });

    res.json({ sessionId });
  }));

  // POST /api/chat/:session_id/message
  router.post('/api/chat/:session_id/message', wrap(async (req, res) => {
    const state = req.app.locals.state as AppState;
    const sessionIdParam = String(req.params.session_id);
    const { content, profileId } = req.body as { content?: string; profileId?: string };

    if (!content?.trim()) throw ApiError.badRequest('content is required');
    if (!profileId?.trim()) throw ApiError.badRequest('profileId is required');

    const dbSession = state.db.getChatSession(sessionIdParam);
    if (!dbSession) throw ApiError.notFound('Chat session not found');

    const profile = state.db.getAgentProfileById(profileId);
    if (!profile) throw ApiError.notFound('Agent profile not found');
    const agentCommand = buildAgentCommand(profile);
    if (!agentCommand.trim()) throw ApiError.badRequest('Agent profile has no command');

    if (dbSession.profile_id !== profileId) {
      state.db.updateChatSession(sessionIdParam, { profile_id: profileId });
    }

    getChatReplStore(sessionIdParam, state);
    const session = liveSessions.get(sessionIdParam);
    if (!session) throw ApiError.notFound('Chat session could not be restored');

    await waitUntilIdle(session);

    const agentSessionId = session.store.getSessionId();
    session.store.push({ type: 'turn_separator', data: '' });
    session.store.push({ type: 'user_message', data: content });

    const repo = state.db.getRepoById(dbSession.repo_id);
    if (!repo) throw ApiError.notFound('Repo not found');

    const prompt = buildChatPrompt(state.db, dbSession.repo_id, content);
    const child = spawnAgent(agentCommand, prompt, repo.path, session.store, agentSessionId);
    monitorChild(session, child);

    const flushInterval = setInterval(() => {
      flushLogs(state, session);
      syncAgentSessionId(state, session);
    }, 2000);
    child.on('exit', () => {
      clearInterval(flushInterval);
      flushLogs(state, session);
      syncAgentSessionId(state, session);
    });

    res.json({ ok: true });
  }));

  // POST /api/chat/:session_id/stop — interrupt the current agent turn
  router.post('/api/chat/:session_id/stop', wrap(async (req, res) => {
    const state = req.app.locals.state as AppState;
    const sessionId = String(req.params.session_id);
    const session = liveSessions.get(sessionId);
    if (session) {
      await killChild(session);
      flushLogs(state, session);
    }
    res.json({ ok: true });
  }));

  // POST /api/chat/:session_id/memory — distil session into a ~200-word memory
  router.post('/api/chat/:session_id/memory', wrap(async (req, res) => {
    const state = req.app.locals.state as AppState;
    const sessionId = String(req.params.session_id);

    const dbSession = state.db.getChatSession(sessionId);
    if (!dbSession) throw ApiError.notFound('Chat session not found');

    const live = liveSessions.get(sessionId);
    if (live) flushLogs(state, live);

    const logs = state.db.getChatLogs(sessionId);
    if (logs.length === 0) throw ApiError.badRequest('Session has no content to summarise');

    const profile = state.db.getAgentProfileById(dbSession.profile_id);
    if (!profile) throw ApiError.notFound('Session agent profile missing');
    const agentCommand = buildAgentCommand(profile);

    const repo = state.db.getRepoById(dbSession.repo_id);
    if (!repo) throw ApiError.notFound('Repo not found');

    const { title, summary } = await summariseChatSession(logs, agentCommand, repo.path);
    const memory = state.db.insertChatMemory(dbSession.repo_id, sessionId, title, summary);

    if (!dbSession.title) {
      state.db.updateChatSession(sessionId, { title });
    }

    res.json({ memory });
  }));

  // GET /api/repos/:repo_id/chat/sessions
  router.get('/api/repos/:repo_id/chat/sessions', wrap(async (req, res) => {
    const state = req.app.locals.state as AppState;
    const repoId = String(req.params.repo_id);
    res.json(state.db.listChatSessions(repoId));
  }));

  // GET /api/chat/:session_id/logs
  router.get('/api/chat/:session_id/logs', wrap(async (req, res) => {
    const state = req.app.locals.state as AppState;
    const sessionId = String(req.params.session_id);

    const dbSession = state.db.getChatSession(sessionId);
    if (!dbSession) throw ApiError.notFound('Session not found');

    const live = liveSessions.get(sessionId);
    if (live) flushLogs(state, live);

    const logs = state.db.getChatLogs(sessionId);
    res.json({ session: dbSession, logs });
  }));

  // PATCH /api/chat/:session_id — rename / archive
  router.patch('/api/chat/:session_id', wrap(async (req, res) => {
    const state = req.app.locals.state as AppState;
    const sessionId = String(req.params.session_id);
    const { title, status } = req.body as { title?: string; status?: string };

    if (!state.db.getChatSession(sessionId)) throw ApiError.notFound('Session not found');

    const updates: Record<string, string> = {};
    if (title !== undefined) updates.title = title;
    if (status === 'archived') updates.status = 'archived';
    state.db.updateChatSession(sessionId, updates);

    res.json({ ok: true });
  }));

  // DELETE /api/chat/:session_id
  router.delete('/api/chat/:session_id', wrap(async (req, res) => {
    const state = req.app.locals.state as AppState;
    const sessionId = String(req.params.session_id);

    const session = liveSessions.get(sessionId);
    if (session) {
      await killChild(session);
      liveSessions.delete(sessionId);
    }
    state.db.deleteChatSession(sessionId);
    res.status(204).end();
  }));

  return router;
}
