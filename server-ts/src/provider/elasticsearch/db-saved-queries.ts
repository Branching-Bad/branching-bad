import type { EsSavedQuery } from './models.js';
import { Db, nowIso } from '../../db/index.js';

declare module '../../db/index.js' {
  interface Db {
    createEsSavedQuery(
      id: string,
      repoId: string,
      indexPattern: string,
      label: string,
      question: string,
      queryTemplate: string,
      keywords: string,
    ): EsSavedQuery;
    getEsSavedQuery(id: string): EsSavedQuery;
    listEsSavedQueries(repoId: string): EsSavedQuery[];
    deleteEsSavedQuery(id: string): void;
    incrementEsSavedQueryUseCount(id: string): void;
  }
}

const ES_SAVED_COLS =
  'id, repo_id, index_pattern, label, question, query_template, keywords, use_count, created_at, updated_at';

function rowToEsSavedQuery(row: any): EsSavedQuery {
  return {
    id: row.id,
    repo_id: row.repo_id,
    index_pattern: row.index_pattern,
    label: row.label,
    question: row.question,
    query_template: row.query_template,
    keywords: row.keywords,
    use_count: row.use_count,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

Db.prototype.createEsSavedQuery = function (
  id: string,
  repoId: string,
  indexPattern: string,
  label: string,
  question: string,
  queryTemplate: string,
  keywords: string,
): EsSavedQuery {
  const db = this.connect();
  const now = nowIso();
  db.prepare(
    'INSERT INTO es_saved_queries (id, repo_id, index_pattern, label, question, query_template, keywords, use_count, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?)',
  ).run(id, repoId, indexPattern, label, question, queryTemplate, keywords, now, now);

  return this.getEsSavedQuery(id);
};

Db.prototype.getEsSavedQuery = function (id: string): EsSavedQuery {
  const db = this.connect();
  const row = db
    .prepare(`SELECT ${ES_SAVED_COLS} FROM es_saved_queries WHERE id = ?`)
    .get(id) as any;
  if (!row) throw new Error(`ES saved query not found: ${id}`);
  return rowToEsSavedQuery(row);
};

Db.prototype.listEsSavedQueries = function (repoId: string): EsSavedQuery[] {
  const db = this.connect();
  const rows = db
    .prepare(
      `SELECT ${ES_SAVED_COLS} FROM es_saved_queries WHERE repo_id = ? ORDER BY use_count DESC, updated_at DESC`,
    )
    .all(repoId) as any[];
  return rows.map(rowToEsSavedQuery);
};

Db.prototype.deleteEsSavedQuery = function (id: string): void {
  const db = this.connect();
  db.prepare('DELETE FROM es_saved_queries WHERE id = ?').run(id);
};

Db.prototype.incrementEsSavedQueryUseCount = function (id: string): void {
  const db = this.connect();
  db.prepare(
    'UPDATE es_saved_queries SET use_count = use_count + 1, updated_at = ? WHERE id = ?',
  ).run(nowIso(), id);
};
