import type { EsInvestigation, EsInvestigationSummary } from './models.js';
import { Db, nowIso } from '../../db/index.js';

declare module '../../db/index.js' {
  interface Db {
    createEsInvestigation(
      id: string,
      repoId: string,
      providerAccountId: string,
      indexPattern: string,
      question: string,
      timeRangeMinutes: number,
    ): EsInvestigation;
    getEsInvestigation(id: string): EsInvestigation;
    updateEsInvestigationStatus(
      id: string,
      status: string,
      resultJson?: any,
      queryPhase1?: string,
      errorMessage?: string,
    ): void;
    setEsInvestigationLinkedTask(id: string, taskId: string): void;
    listEsInvestigations(repoId: string): EsInvestigationSummary[];
  }
}

const ES_INV_COLS =
  'id, repo_id, provider_account_id, index_pattern, question, time_range_minutes, query_phase1, query_phase2, result_json, status, linked_task_id, error_message, created_at, completed_at';

function rowToEsInvestigation(row: any): EsInvestigation {
  return {
    id: row.id,
    repo_id: row.repo_id,
    provider_account_id: row.provider_account_id,
    index_pattern: row.index_pattern,
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

Db.prototype.createEsInvestigation = function (
  id: string,
  repoId: string,
  providerAccountId: string,
  indexPattern: string,
  question: string,
  timeRangeMinutes: number,
): EsInvestigation {
  const db = this.connect();
  const now = nowIso();
  db.prepare(
    "INSERT INTO es_investigations (id, repo_id, provider_account_id, index_pattern, question, time_range_minutes, status, result_json, created_at) VALUES (?, ?, ?, ?, ?, ?, 'running', '{}', ?)",
  ).run(id, repoId, providerAccountId, indexPattern, question, timeRangeMinutes, now);

  return this.getEsInvestigation(id);
};

Db.prototype.getEsInvestigation = function (id: string): EsInvestigation {
  const db = this.connect();
  const row = db
    .prepare(`SELECT ${ES_INV_COLS} FROM es_investigations WHERE id = ?`)
    .get(id) as any;
  if (!row) throw new Error(`ES investigation not found: ${id}`);
  return rowToEsInvestigation(row);
};

Db.prototype.updateEsInvestigationStatus = function (
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
      'UPDATE es_investigations SET status = ?, result_json = ?, query_phase1 = COALESCE(?, query_phase1), error_message = ?, completed_at = COALESCE(?, completed_at) WHERE id = ?',
    ).run(status, rjStr, queryPhase1 ?? null, errorMessage ?? null, completedAt, id);
  } else {
    db.prepare(
      'UPDATE es_investigations SET status = ?, query_phase1 = COALESCE(?, query_phase1), error_message = ?, completed_at = COALESCE(?, completed_at) WHERE id = ?',
    ).run(status, queryPhase1 ?? null, errorMessage ?? null, completedAt, id);
  }
};

Db.prototype.setEsInvestigationLinkedTask = function (
  id: string,
  taskId: string,
): void {
  const db = this.connect();
  db.prepare('UPDATE es_investigations SET linked_task_id = ? WHERE id = ?').run(
    taskId,
    id,
  );
};

Db.prototype.listEsInvestigations = function (
  repoId: string,
): EsInvestigationSummary[] {
  const db = this.connect();
  const rows = db
    .prepare(
      'SELECT id, question, index_pattern, status, created_at FROM es_investigations WHERE repo_id = ? ORDER BY created_at DESC LIMIT 50',
    )
    .all(repoId) as any[];
  return rows.map((row) => ({
    id: row.id,
    question: row.question,
    index_pattern: row.index_pattern,
    status: row.status,
    created_at: row.created_at,
  }));
};
