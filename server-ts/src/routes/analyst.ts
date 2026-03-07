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

// ---------------------------------------------------------------------------
// Session tracking
// ---------------------------------------------------------------------------

interface AnalystSession {
  id: string;
  repoId: string;
  store: MsgStore;
  child: ChildProcess | null;
  idle: boolean;
}

const sessions = new Map<string, AnalystSession>();

export function getAnalystStore(sessionId: string): MsgStore | undefined {
  return sessions.get(sessionId)?.store;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function monitorChild(session: AnalystSession, child: ChildProcess): void {
  session.child = child;
  session.idle = false;

  const onExit = () => {
    session.idle = true;
    session.child = null;
  };

  child.on('exit', onExit);
}

function killChild(session: AnalystSession): Promise<void> {
  const child = session.child;
  if (!child || child.pid == null) return Promise.resolve();

  return new Promise((resolve) => {
    treeKill(child.pid!, 'SIGTERM', () => {
      session.child = null;
      resolve();
    });
  });
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

    // Build multi-repo context
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
    const session: AnalystSession = { id: sessionId, repoId: repoId, store, child: null, idle: false };
    sessions.set(sessionId, session);

    const child = spawnAgent(agentCommand, prompt, repo.path, store);
    monitorChild(session, child);

    res.json({ sessionId });
  }));

  // POST /api/analyst/:session_id/message
  router.post('/api/analyst/:session_id/message', wrap(async (req, res) => {
    const state = req.app.locals.state as AppState;
    const sessionIdParam = String(req.params.session_id);
    const { content, profileId } = req.body as { content?: string; profileId?: string };

    if (!content?.trim()) throw ApiError.badRequest('content is required');

    const session = sessions.get(sessionIdParam);
    if (!session) throw ApiError.notFound('Analyst session not found');

    // Wait for current agent to finish if still running
    if (session.child && !session.idle) {
      await new Promise<void>((resolve) => {
        const check = () => {
          if (session.idle || !session.child) { resolve(); return; }
          setTimeout(check, 200);
        };
        check();
      });
    }

    const agentSessionId = session.store.getSessionId();

    session.store.push({ type: 'turn_separator', data: '' });
    session.store.push({ type: 'user_message', data: content });

    const repo = state.db.getRepoById(session.repoId);
    if (!repo) throw ApiError.notFound('Repo not found');

    if (!profileId?.trim()) throw ApiError.badRequest('profileId is required');
    const profile = state.db.getAgentProfileById(profileId);
    if (!profile) throw ApiError.notFound('Agent profile not found');
    const agentCommand = buildAgentCommand(profile);
    if (!agentCommand.trim()) throw ApiError.badRequest('Agent profile has no command');

    const prompt = buildAnalystFollowUpPrompt(content);
    const child = spawnAgent(agentCommand, prompt, repo.path, session.store, agentSessionId);
    monitorChild(session, child);

    res.json({ ok: true });
  }));

  // DELETE /api/analyst/:session_id
  router.delete('/api/analyst/:session_id', wrap(async (req, res) => {
    const session_id = String(req.params.session_id);
    const session = sessions.get(session_id);
    if (!session) { res.status(204).end(); return; }

    await killChild(session);
    sessions.delete(session_id);

    res.status(204).end();
  }));

  return router;
}
