import type { ChatSession, ChatLog } from '../models.js';
import { Db, nowIso } from './index.js';

declare module './index.js' {
  interface Db {
    createChatSession(id: string, repoId: string, profileId: string, firstMessage: string): ChatSession;
    updateChatSession(
      id: string,
      updates: Partial<Pick<ChatSession, 'agent_session_id' | 'title' | 'status' | 'profile_id'>>,
    ): void;
    getChatSession(id: string): ChatSession | null;
    listChatSessions(repoId: string): ChatSession[];
    deleteChatSession(id: string): void;
    appendChatLogs(sessionId: string, logs: { type: string; data: string }[]): void;
    getChatLogs(sessionId: string): ChatLog[];
    getChatLogCount(sessionId: string): number;
  }
}

function rowToSession(row: any): ChatSession {
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

Db.prototype.createChatSession = function (
  id: string, repoId: string, profileId: string, firstMessage: string,
): ChatSession {
  const db = this.connect();
  const ts = nowIso();
  db.prepare(
    `INSERT INTO chat_sessions (id, repo_id, profile_id, first_message, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'active', ?, ?)`,
  ).run(id, repoId, profileId, firstMessage, ts, ts);
  return {
    id, repo_id: repoId, profile_id: profileId, agent_session_id: null,
    title: null, first_message: firstMessage, status: 'active',
    created_at: ts, updated_at: ts,
  };
};

Db.prototype.updateChatSession = function (
  id: string,
  updates: Partial<Pick<ChatSession, 'agent_session_id' | 'title' | 'status' | 'profile_id'>>,
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
  db.prepare(`UPDATE chat_sessions SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
};

Db.prototype.getChatSession = function (id: string): ChatSession | null {
  const db = this.connect();
  const row = db.prepare('SELECT * FROM chat_sessions WHERE id = ?').get(id) as any;
  return row ? rowToSession(row) : null;
};

Db.prototype.listChatSessions = function (repoId: string): ChatSession[] {
  const db = this.connect();
  const rows = db.prepare(
    'SELECT * FROM chat_sessions WHERE repo_id = ? ORDER BY updated_at DESC',
  ).all(repoId) as any[];
  return rows.map(rowToSession);
};

Db.prototype.deleteChatSession = function (id: string): void {
  const db = this.connect();
  db.prepare('DELETE FROM chat_logs WHERE session_id = ?').run(id);
  db.prepare('DELETE FROM chat_sessions WHERE id = ?').run(id);
};

Db.prototype.appendChatLogs = function (
  sessionId: string, logs: { type: string; data: string }[],
): void {
  if (logs.length === 0) return;
  const db = this.connect();
  const ts = nowIso();
  const stmt = db.prepare(
    'INSERT INTO chat_logs (session_id, type, data, created_at) VALUES (?, ?, ?, ?)',
  );
  const tx = this.transaction(() => {
    for (const log of logs) stmt.run(sessionId, log.type, log.data, ts);
  });
  tx();
};

Db.prototype.getChatLogs = function (sessionId: string): ChatLog[] {
  const db = this.connect();
  const rows = db.prepare(
    'SELECT * FROM chat_logs WHERE session_id = ? ORDER BY id ASC',
  ).all(sessionId) as any[];
  return rows as ChatLog[];
};

Db.prototype.getChatLogCount = function (sessionId: string): number {
  const db = this.connect();
  const row = db.prepare(
    'SELECT COUNT(*) as cnt FROM chat_logs WHERE session_id = ?',
  ).get(sessionId) as any;
  return row?.cnt ?? 0;
};
