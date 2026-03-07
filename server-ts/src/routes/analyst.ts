import { Router, type Request, type Response, type NextFunction } from 'express';
import { randomUUID } from 'crypto';
import treeKill from 'tree-kill';
import type { ChildProcess } from 'child_process';

import type { AppState } from '../state.js';
import { ApiError } from '../errors.js';
import { MsgStore } from '../msgStore.js';
import { spawnAgent } from '../executor/agent.js';
import { buildAgentCommand } from './shared.js';
import { buildAnalystStartPrompt, buildAnalystFollowUpPrompt, type AnalystRepo } from '../services/analystService.js';

/**
 * Append agent-specific flags to restrict filesystem scope to the given repo paths.
 */
function buildScopedCommand(agentCommand: string, repoPaths: string[]): string {
  const cmd = agentCommand.toLowerCase();

  if (cmd.includes('claude')) {
    // Claude Code: --add-dir for additional repos (cwd is already primary)
    if (repoPaths.length > 1) {
      const extra = repoPaths.slice(1).map((p) => `--add-dir "${p}"`).join(' ');
      return `${agentCommand} ${extra}`;
    }
    return agentCommand;
  }

  if (cmd.includes('codex')) {
    // Codex: --writable-root for each repo path
    const roots = repoPaths.map((p) => `--writable-root "${p}"`).join(' ');
    return `${agentCommand} ${roots}`;
  }

  if (cmd.includes('gemini')) {
    // Gemini: --include-directories for additional repos
    if (repoPaths.length > 1) {
      const extra = repoPaths.slice(1).join(',');
      return `${agentCommand} --include-directories ${extra}`;
    }
    return agentCommand;
  }

  return agentCommand;
}

// ---------------------------------------------------------------------------
// In-memory process tracking (not persisted — only for live sessions)
// ---------------------------------------------------------------------------

interface LiveSession {
  id: string;
  store: MsgStore;
  child: ChildProcess | null;
  idle: boolean;
  lastLogIndex: number; // how many logs already saved to DB
}

const liveSessions = new Map<string, LiveSession>();

export function getAnalystStore(sessionId: string, state?: AppState): MsgStore | undefined {
  const existing = liveSessions.get(sessionId);
  if (existing) return existing.store;

  // Rehydrate from DB if state is available (e.g. after server restart)
  if (!state) return undefined;
  const dbSession = state.db.getAnalystSession(sessionId);
  if (!dbSession) return undefined;

  const store = new MsgStore();
  const savedLogs = state.db.getAnalystLogs(sessionId);
  for (const log of savedLogs) {
    store.push({ type: log.type as 'stdout', data: log.data });
  }
  if (dbSession.agent_session_id) {
    store.setSessionId(dbSession.agent_session_id);
  }
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
  child.on('exit', () => { session.idle = true; session.child = null; });
}

function killChild(session: LiveSession): Promise<void> {
  const child = session.child;
  if (!child || child.pid == null) return Promise.resolve();
  return new Promise((resolve) => {
    treeKill(child.pid!, 'SIGTERM', () => { session.child = null; resolve(); });
  });
}

/** Flush new logs from MsgStore to DB */
function flushLogs(state: AppState, session: LiveSession): void {
  const allLogs = session.store.getHistory();
  const newLogs = allLogs.slice(session.lastLogIndex);
  if (newLogs.length === 0) return;
  state.db.appendAnalystLogs(session.id, newLogs);
  session.lastLogIndex = allLogs.length;
}

/** Save agent_session_id if captured */
function syncAgentSessionId(state: AppState, session: LiveSession): void {
  const agentSid = session.store.getSessionId();
  if (agentSid) {
    state.db.updateAnalystSession(session.id, { agent_session_id: agentSid });
  }
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

function wrap(fn: (req: Request, res: Response) => Promise<void>) {
  return (req: Request, res: Response, next: NextFunction) => {
    fn(req, res).catch(next);
  };
}

export function analystRoutes(): Router {
  const router = Router();

  // POST /api/repos/:repo_id/analyst/start
  router.post('/api/repos/:repo_id/analyst/start', wrap(async (req, res) => {
    const state = req.app.locals.state as AppState;
    const repoId = String(req.params.repo_id);
    const { message, profileId, additionalRepoIds } = req.body as {
      message?: string; profileId?: string; additionalRepoIds?: string[];
    };

    if (!message?.trim()) throw ApiError.badRequest('message is required');
    if (!profileId?.trim()) throw ApiError.badRequest('profileId is required');

    const repo = state.db.getRepoById(repoId);
    if (!repo) throw ApiError.notFound('Repo not found');

    const profile = state.db.getAgentProfileById(profileId);
    if (!profile) throw ApiError.notFound('Agent profile not found');

    const agentCommand = buildAgentCommand(profile);
    if (!agentCommand.trim()) throw ApiError.badRequest('Agent profile has no command');

    const repos: AnalystRepo[] = [{ name: repo.name, path: repo.path, repoId }];
    if (Array.isArray(additionalRepoIds)) {
      for (const extraId of additionalRepoIds) {
        const extra = state.db.getRepoById(String(extraId));
        if (extra) repos.push({ name: extra.name, path: extra.path, repoId: extra.id });
      }
    }

    const prompt = buildAnalystStartPrompt(repos, message, state.db);
    const store = new MsgStore();
    store.push({ type: 'user_message', data: message });

    const sessionId = randomUUID();

    // Persist to DB
    state.db.createAnalystSession(sessionId, repoId, profileId, message);

    const repoPaths = repos.map((r) => r.path);
    const scopedCommand = buildScopedCommand(agentCommand, repoPaths);

    const session: LiveSession = { id: sessionId, store, child: null, idle: false, lastLogIndex: 0 };
    liveSessions.set(sessionId, session);

    const child = spawnAgent(scopedCommand, prompt, repo.path, store);
    monitorChild(session, child);

    // Flush logs periodically while child is alive
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

  // POST /api/analyst/:session_id/message
  router.post('/api/analyst/:session_id/message', wrap(async (req, res) => {
    const state = req.app.locals.state as AppState;
    const sessionIdParam = String(req.params.session_id);
    const { content, profileId } = req.body as { content?: string; profileId?: string };

    if (!content?.trim()) throw ApiError.badRequest('content is required');
    if (!profileId?.trim()) throw ApiError.badRequest('profileId is required');

    const dbSession = state.db.getAnalystSession(sessionIdParam);
    if (!dbSession) throw ApiError.notFound('Analyst session not found');

    const profile = state.db.getAgentProfileById(profileId);
    if (!profile) throw ApiError.notFound('Agent profile not found');
    const agentCommand = buildAgentCommand(profile);
    if (!agentCommand.trim()) throw ApiError.badRequest('Agent profile has no command');

    // Update profile if changed
    if (dbSession.profile_id !== profileId) {
      state.db.updateAnalystSession(sessionIdParam, { profile_id: profileId });
    }

    // Get or create live session (rehydrates from DB if needed)
    getAnalystStore(sessionIdParam, state);
    let session = liveSessions.get(sessionIdParam);
    if (!session) throw ApiError.notFound('Analyst session could not be restored');

    // Wait for current agent to finish if still running
    if (session.child && !session.idle) {
      await new Promise<void>((resolve) => {
        const check = () => {
          if (session!.idle || !session!.child) { resolve(); return; }
          setTimeout(check, 200);
        };
        check();
      });
    }

    const agentSessionId = session.store.getSessionId();

    session.store.push({ type: 'turn_separator', data: '' });
    session.store.push({ type: 'user_message', data: content });

    const repo = state.db.getRepoById(dbSession.repo_id);
    if (!repo) throw ApiError.notFound('Repo not found');

    const scopedCommand = buildScopedCommand(agentCommand, [repo.path]);
    const prompt = buildAnalystFollowUpPrompt(content);
    const child = spawnAgent(scopedCommand, prompt, repo.path, session.store, agentSessionId);
    monitorChild(session, child);

    const flushInterval = setInterval(() => {
      flushLogs(state, session!);
      syncAgentSessionId(state, session!);
    }, 2000);
    child.on('exit', () => {
      clearInterval(flushInterval);
      flushLogs(state, session!);
      syncAgentSessionId(state, session!);
    });

    res.json({ ok: true });
  }));

  // GET /api/repos/:repo_id/analyst/sessions — list sessions for repo
  router.get('/api/repos/:repo_id/analyst/sessions', wrap(async (req, res) => {
    const state = req.app.locals.state as AppState;
    const repoId = String(req.params.repo_id);
    const sessions = state.db.listAnalystSessions(repoId);
    res.json(sessions);
  }));

  // GET /api/analyst/:session_id/logs — get logs for a session
  router.get('/api/analyst/:session_id/logs', wrap(async (req, res) => {
    const state = req.app.locals.state as AppState;
    const sessionId = String(req.params.session_id);

    const dbSession = state.db.getAnalystSession(sessionId);
    if (!dbSession) throw ApiError.notFound('Session not found');

    // If live, flush first
    const live = liveSessions.get(sessionId);
    if (live) flushLogs(state, live);

    const logs = state.db.getAnalystLogs(sessionId);
    res.json({ session: dbSession, logs });
  }));

  // PATCH /api/analyst/:session_id — update session (title, status)
  router.patch('/api/analyst/:session_id', wrap(async (req, res) => {
    const state = req.app.locals.state as AppState;
    const sessionId = String(req.params.session_id);
    const { title, status } = req.body as { title?: string; status?: string };

    const dbSession = state.db.getAnalystSession(sessionId);
    if (!dbSession) throw ApiError.notFound('Session not found');

    const updates: Record<string, string> = {};
    if (title !== undefined) updates.title = title;
    if (status === 'archived') updates.status = 'archived';
    state.db.updateAnalystSession(sessionId, updates);

    res.json({ ok: true });
  }));

  // DELETE /api/analyst/:session_id
  router.delete('/api/analyst/:session_id', wrap(async (req, res) => {
    const state = req.app.locals.state as AppState;
    const sessionId = String(req.params.session_id);

    const session = liveSessions.get(sessionId);
    if (session) {
      await killChild(session);
      liveSessions.delete(sessionId);
    }

    state.db.deleteAnalystSession(sessionId);
    res.status(204).end();
  }));

  return router;
}
