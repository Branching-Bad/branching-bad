import { v4 as uuidv4 } from 'uuid';
import { Db, nowIso } from './index.js';

export interface TaskMemory {
  id: string;
  repo_id: string;
  task_id: string | null;
  run_id: string | null;
  chat_session_id: string | null;
  title: string;
  summary: string;
  files_changed: string[];
  created_at: string;
}

export interface TaskMemoryWithRank extends TaskMemory {
  rank: number;
}

declare module './index.js' {
  interface Db {
    insertTaskMemory(
      repoId: string,
      taskId: string,
      runId: string,
      title: string,
      summary: string,
      filesChanged: string[],
    ): TaskMemory;
    insertChatMemory(
      repoId: string,
      chatSessionId: string,
      title: string,
      summary: string,
    ): TaskMemory;
    searchMemories(repoId: string, query: string, limit?: number): TaskMemory[];
    searchMemoriesWithRank(repoId: string, query: string, limit?: number): TaskMemoryWithRank[];
    listMemories(repoId: string, limit: number, offset: number): { memories: TaskMemory[]; total: number };
    getMemoriesByTask(taskId: string): TaskMemory[];
    hasMemoriesForTask(taskId: string): boolean;
    deleteMemory(id: string): void;
    findMemoryByTitle(repoId: string, title: string): TaskMemory | null;
    updateMemorySummary(id: string, summary: string, filesChanged: string[]): void;
  }
}

function rowToMemory(row: any): TaskMemory {
  return {
    id: row.id,
    repo_id: row.repo_id,
    task_id: row.task_id,
    run_id: row.run_id,
    chat_session_id: row.chat_session_id ?? null,
    title: row.title,
    summary: row.summary,
    files_changed: JSON.parse(row.files_changed || '[]'),
    created_at: row.created_at,
  };
}

Db.prototype.insertTaskMemory = function (
  repoId: string,
  taskId: string,
  runId: string,
  title: string,
  summary: string,
  filesChanged: string[],
): TaskMemory {
  const db = this.connect();
  const id = uuidv4();
  const ts = nowIso();
  const filesJson = JSON.stringify(filesChanged);
  db.prepare(
    `INSERT INTO task_memories (id, repo_id, task_id, run_id, title, summary, files_changed, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(id, repoId, taskId, runId, title, summary, filesJson, ts);
  return {
    id, repo_id: repoId, task_id: taskId, run_id: runId, chat_session_id: null,
    title, summary, files_changed: filesChanged, created_at: ts,
  };
};

Db.prototype.insertChatMemory = function (
  repoId: string,
  chatSessionId: string,
  title: string,
  summary: string,
): TaskMemory {
  const db = this.connect();
  const id = uuidv4();
  const ts = nowIso();
  db.prepare(
    `INSERT INTO task_memories (id, repo_id, chat_session_id, title, summary, files_changed, created_at)
     VALUES (?, ?, ?, ?, ?, '[]', ?)`,
  ).run(id, repoId, chatSessionId, title, summary, ts);
  return {
    id, repo_id: repoId, task_id: null, run_id: null, chat_session_id: chatSessionId,
    title, summary, files_changed: [], created_at: ts,
  };
};

Db.prototype.searchMemories = function (
  repoId: string,
  query: string,
  limit = 5,
): TaskMemory[] {
  const db = this.connect();
  const rows = db.prepare(
    `SELECT m.* FROM task_memories m
     JOIN task_memories_fts fts ON m.rowid = fts.rowid
     WHERE task_memories_fts MATCH ? AND m.repo_id = ?
     ORDER BY bm25(task_memories_fts) LIMIT ?`,
  ).all(query, repoId, limit) as any[];
  return rows.map(rowToMemory);
};

Db.prototype.searchMemoriesWithRank = function (
  repoId: string,
  query: string,
  limit = 10,
): TaskMemoryWithRank[] {
  const db = this.connect();
  const rows = db.prepare(
    `SELECT m.*, bm25(task_memories_fts) AS rank FROM task_memories m
     JOIN task_memories_fts fts ON m.rowid = fts.rowid
     WHERE task_memories_fts MATCH ? AND m.repo_id = ?
     ORDER BY rank LIMIT ?`,
  ).all(query, repoId, limit) as any[];
  return rows.map((r) => ({ ...rowToMemory(r), rank: typeof r.rank === 'number' ? r.rank : 0 }));
};

Db.prototype.listMemories = function (
  repoId: string,
  limit: number,
  offset: number,
): { memories: TaskMemory[]; total: number } {
  const db = this.connect();
  const totalRow = db.prepare(
    'SELECT COUNT(*) as cnt FROM task_memories WHERE repo_id = ?',
  ).get(repoId) as any;
  const total = totalRow?.cnt ?? 0;
  const rows = db.prepare(
    'SELECT * FROM task_memories WHERE repo_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?',
  ).all(repoId, limit, offset) as any[];
  return { memories: rows.map(rowToMemory), total };
};

Db.prototype.getMemoriesByTask = function (taskId: string): TaskMemory[] {
  const db = this.connect();
  const rows = db.prepare(
    'SELECT * FROM task_memories WHERE task_id = ? ORDER BY created_at DESC',
  ).all(taskId) as any[];
  return rows.map(rowToMemory);
};

Db.prototype.hasMemoriesForTask = function (taskId: string): boolean {
  const db = this.connect();
  const row = db.prepare(
    'SELECT 1 FROM task_memories WHERE task_id = ? LIMIT 1',
  ).get(taskId);
  return !!row;
};

Db.prototype.deleteMemory = function (id: string): void {
  const db = this.connect();
  db.prepare('DELETE FROM task_memories WHERE id = ?').run(id);
};

Db.prototype.findMemoryByTitle = function (
  repoId: string,
  title: string,
): TaskMemory | null {
  const db = this.connect();
  const row = db.prepare(
    'SELECT * FROM task_memories WHERE repo_id = ? AND LOWER(title) = LOWER(?) LIMIT 1',
  ).get(repoId, title) as any;
  return row ? rowToMemory(row) : null;
};

Db.prototype.updateMemorySummary = function (
  id: string,
  summary: string,
  filesChanged: string[],
): void {
  const db = this.connect();
  db.prepare(
    'UPDATE task_memories SET summary = ?, files_changed = ? WHERE id = ?',
  ).run(summary, JSON.stringify(filesChanged), id);
};
