import type { CwInvestigation, CwSavedQuery } from './models.js';
import { Db, nowIso } from '../../db/index.js';

declare module '../../db/index.js' {
  interface Db {
    createInvestigation(
      id: string,
      repoId: string,
      providerAccountId: string,
      logGroup: string,
      question: string,
      timeRangeMinutes: number,
    ): CwInvestigation;
    getInvestigation(id: string): CwInvestigation;
    updateInvestigationStatus(
      id: string,
      status: string,
      resultJson?: any,
      queryPhase1?: string,
      errorMessage?: string,
    ): void;
    setInvestigationLinkedTask(id: string, taskId: string): void;
    listInvestigations(repoId: string): CwInvestigation[];
    createSavedQuery(
      id: string,
      repoId: string,
      logGroup: string,
      label: string,
      question: string,
      queryTemplate: string,
      keywords: string,
    ): CwSavedQuery;
    getSavedQuery(id: string): CwSavedQuery;
    listSavedQueries(repoId: string): CwSavedQuery[];
    deleteSavedQuery(id: string): void;
    incrementSavedQueryUseCount(id: string): void;
  }
}

function rowToInvestigation(row: any): CwInvestigation {
  return {
    id: row.id,
    repo_id: row.repo_id,
    provider_account_id: row.provider_account_id,
    log_group: row.log_group,
    question: row.question,
    time_range_minutes: row.time_range_minutes,
    query_phase1: row.query_phase1,
    query_phase2: row.query_phase2,
    result_json: JSON.parse(row.result_json || '{}'),
    status: row.status,
    linked_task_id: row.linked_task_id,
    error_message: row.error_message,
    created_at: row.created_at,
    completed_at: row.completed_at,
  };
}

const INV_COLS =
  'id, repo_id, provider_account_id, log_group, question, time_range_minutes, query_phase1, query_phase2, result_json, status, linked_task_id, error_message, created_at, completed_at';

const SAVED_COLS =
  'id, repo_id, log_group, label, question, query_template, keywords, use_count, created_at, updated_at';

function rowToSavedQuery(row: any): CwSavedQuery {
  return {
    id: row.id,
    repo_id: row.repo_id,
    log_group: row.log_group,
    label: row.label,
    question: row.question,
    query_template: row.query_template,
    keywords: row.keywords,
    use_count: row.use_count,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

Db.prototype.createInvestigation = function (
  id: string,
  repoId: string,
  providerAccountId: string,
  logGroup: string,
  question: string,
  timeRangeMinutes: number,
): CwInvestigation {
  const db = this.connect();
    const now = nowIso();
    db.prepare(
      "INSERT INTO cw_investigations (id, repo_id, provider_account_id, log_group, question, time_range_minutes, status, result_json, created_at) VALUES (?, ?, ?, ?, ?, ?, 'running', '{}', ?)",
    ).run(id, repoId, providerAccountId, logGroup, question, timeRangeMinutes, now);

    return this.getInvestigation(id);
};

Db.prototype.getInvestigation = function (id: string): CwInvestigation {
  const db = this.connect();
    const row = db
      .prepare(`SELECT ${INV_COLS} FROM cw_investigations WHERE id = ?`)
      .get(id) as any;
    if (!row) throw new Error(`Investigation not found: ${id}`);
    return rowToInvestigation(row);
};

Db.prototype.updateInvestigationStatus = function (
  id: string,
  status: string,
  resultJson?: any,
  queryPhase1?: string,
  errorMessage?: string,
): void {
  const db = this.connect();
    const isTerminal = status === 'completed' || status === 'failed' || status === 'no_results';
    const completedAt = isTerminal ? nowIso() : null;

    if (resultJson != null) {
      const rjStr = JSON.stringify(resultJson);
      db.prepare(
        'UPDATE cw_investigations SET status = ?, result_json = ?, query_phase1 = COALESCE(?, query_phase1), error_message = ?, completed_at = COALESCE(?, completed_at) WHERE id = ?',
      ).run(status, rjStr, queryPhase1 ?? null, errorMessage ?? null, completedAt, id);
    } else {
      db.prepare(
        'UPDATE cw_investigations SET status = ?, query_phase1 = COALESCE(?, query_phase1), error_message = ?, completed_at = COALESCE(?, completed_at) WHERE id = ?',
      ).run(status, queryPhase1 ?? null, errorMessage ?? null, completedAt, id);
    }
};

Db.prototype.setInvestigationLinkedTask = function (id: string, taskId: string): void {
  const db = this.connect();
    db.prepare('UPDATE cw_investigations SET linked_task_id = ? WHERE id = ?').run(
      taskId,
      id,
    );
};

Db.prototype.listInvestigations = function (repoId: string): CwInvestigation[] {
  const db = this.connect();
    const rows = db
      .prepare(
        `SELECT ${INV_COLS} FROM cw_investigations WHERE repo_id = ? ORDER BY created_at DESC LIMIT 50`,
      )
      .all(repoId) as any[];
    return rows.map(rowToInvestigation);
};

Db.prototype.createSavedQuery = function (
  id: string,
  repoId: string,
  logGroup: string,
  label: string,
  question: string,
  queryTemplate: string,
  keywords: string,
): CwSavedQuery {
  const db = this.connect();
    const now = nowIso();
    db.prepare(
      'INSERT INTO cw_saved_queries (id, repo_id, log_group, label, question, query_template, keywords, use_count, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?)',
    ).run(id, repoId, logGroup, label, question, queryTemplate, keywords, now, now);

    return this.getSavedQuery(id);
};

Db.prototype.getSavedQuery = function (id: string): CwSavedQuery {
  const db = this.connect();
    const row = db
      .prepare(`SELECT ${SAVED_COLS} FROM cw_saved_queries WHERE id = ?`)
      .get(id) as any;
    if (!row) throw new Error(`Saved query not found: ${id}`);
    return rowToSavedQuery(row);
};

Db.prototype.listSavedQueries = function (repoId: string): CwSavedQuery[] {
  const db = this.connect();
    const rows = db
      .prepare(
        `SELECT ${SAVED_COLS} FROM cw_saved_queries WHERE repo_id = ? ORDER BY use_count DESC, updated_at DESC`,
      )
      .all(repoId) as any[];
    return rows.map(rowToSavedQuery);
};

Db.prototype.deleteSavedQuery = function (id: string): void {
  const db = this.connect();
    db.prepare('DELETE FROM cw_saved_queries WHERE id = ?').run(id);
};

Db.prototype.incrementSavedQueryUseCount = function (id: string): void {
  const db = this.connect();
    db.prepare(
      'UPDATE cw_saved_queries SET use_count = use_count + 1, updated_at = ? WHERE id = ?',
    ).run(nowIso(), id);
};
