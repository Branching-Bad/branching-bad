import type { AnalystSession, AnalystLog } from '../models.js';
import { Db, nowIso } from './index.js';

declare module './index.js' {
  interface Db {
    createAnalystSession(id: string, repoId: string, profileId: string, firstMessage: string): AnalystSession;
    updateAnalystSession(id: string, updates: Partial<Pick<AnalystSession, 'agent_session_id' | 'title' | 'status' | 'profile_id'>>): void;
    getAnalystSession(id: string): AnalystSession | null;
    listAnalystSessions(repoId: string): AnalystSession[];
    deleteAnalystSession(id: string): void;
    appendAnalystLogs(sessionId: string, logs: { type: string; data: string }[]): void;
    getAnalystLogs(sessionId: string): AnalystLog[];
    getAnalystLogCount(sessionId: string): number;
  }
}

function rowToSession(row: any): AnalystSession {
  return {
    id: row.id,
    repo_id: row.repo_id,
    profile_id: row.profile_id,
    agent_session_id: row.agent_session_id,
    title: row.title,
    first_message: row.first_message,
    status: row.status,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

Db.prototype.createAnalystSession = function (
  id: string, repoId: string, profileId: string, firstMessage: string,
): AnalystSession {
  const db = this.connect();
  const ts = nowIso();
  db.prepare(
    `INSERT INTO analyst_sessions (id, repo_id, profile_id, first_message, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'active', ?, ?)`,
  ).run(id, repoId, profileId, firstMessage, ts, ts);
  return {
    id, repo_id: repoId, profile_id: profileId, agent_session_id: null,
    title: null, first_message: firstMessage, status: 'active',
    created_at: ts, updated_at: ts,
  };
};

Db.prototype.updateAnalystSession = function (
  id: string, updates: Partial<Pick<AnalystSession, 'agent_session_id' | 'title' | 'status' | 'profile_id'>>,
): void {
  const db = this.connect();
  const sets: string[] = [];
  const vals: (string | null)[] = [];
  if (updates.agent_session_id !== undefined) { sets.push('agent_session_id = ?'); vals.push(updates.agent_session_id); }
  if (updates.title !== undefined) { sets.push('title = ?'); vals.push(updates.title); }
  if (updates.status !== undefined) { sets.push('status = ?'); vals.push(updates.status); }
  if (updates.profile_id !== undefined) { sets.push('profile_id = ?'); vals.push(updates.profile_id); }
  if (sets.length === 0) return;
  sets.push('updated_at = ?');
  vals.push(nowIso());
  vals.push(id);
  db.prepare(`UPDATE analyst_sessions SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
};

Db.prototype.getAnalystSession = function (id: string): AnalystSession | null {
  const db = this.connect();
  const row = db.prepare('SELECT * FROM analyst_sessions WHERE id = ?').get(id) as any;
  return row ? rowToSession(row) : null;
};

Db.prototype.listAnalystSessions = function (repoId: string): AnalystSession[] {
  const db = this.connect();
  const rows = db.prepare(
    'SELECT * FROM analyst_sessions WHERE repo_id = ? ORDER BY updated_at DESC',
  ).all(repoId) as any[];
  return rows.map(rowToSession);
};

Db.prototype.deleteAnalystSession = function (id: string): void {
  const db = this.connect();
  db.prepare('DELETE FROM analyst_sessions WHERE id = ?').run(id);
};

Db.prototype.appendAnalystLogs = function (
  sessionId: string, logs: { type: string; data: string }[],
): void {
  const db = this.connect();
  const ts = nowIso();
  const stmt = db.prepare(
    'INSERT INTO analyst_logs (session_id, type, data, created_at) VALUES (?, ?, ?, ?)',
  );
  for (const log of logs) {
    stmt.run(sessionId, log.type, log.data, ts);
  }
};

Db.prototype.getAnalystLogs = function (sessionId: string): AnalystLog[] {
  const db = this.connect();
  const rows = db.prepare(
    'SELECT * FROM analyst_logs WHERE session_id = ? ORDER BY id ASC',
  ).all(sessionId) as any[];
  return rows.map((r: any) => ({
    id: r.id, session_id: r.session_id,
    type: r.type, data: r.data, created_at: r.created_at,
  }));
};

Db.prototype.getAnalystLogCount = function (sessionId: string): number {
  const db = this.connect();
  const row = db.prepare(
    'SELECT COUNT(*) as cnt FROM analyst_logs WHERE session_id = ?',
  ).get(sessionId) as { cnt: number };
  return row.cnt;
};
