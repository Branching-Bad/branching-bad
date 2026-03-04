import { v4 as uuidv4 } from 'uuid';
import type { AutostartJob } from '../models.js';
import { Db, nowIso } from './index.js';

declare module './index.js' {
  interface Db {
    enqueueAutostartJob(taskId: string, triggerKind: string): AutostartJob;
    claimNextPendingAutostartJob(): AutostartJob | null;
    completeAutostartJob(jobId: string, planId?: string, runId?: string): void;
    failAutostartJob(
      jobId: string,
      error: string,
      planId?: string,
      runId?: string,
    ): void;
    requeueAutostartJob(jobId: string, error?: string): void;
    getAutostartJobById(jobId: string): AutostartJob | null;
  }
}

const AUTOSTART_COLS =
  'id, task_id, trigger_kind, state, plan_id, run_id, error, created_at, updated_at, started_at, completed_at';

function rowToAutostartJob(row: any): AutostartJob {
  return {
    id: row.id,
    task_id: row.task_id,
    trigger_kind: row.trigger_kind,
    state: row.state,
    plan_id: row.plan_id,
    run_id: row.run_id,
    error: row.error,
    created_at: row.created_at,
    updated_at: row.updated_at,
    started_at: row.started_at,
    completed_at: row.completed_at,
  };
}

Db.prototype.enqueueAutostartJob = function (
  taskId: string,
  triggerKind: string,
): AutostartJob {
  const db = this.connect();
    const existing = db
      .prepare(
        `SELECT ${AUTOSTART_COLS} FROM autostart_jobs
         WHERE task_id = ? AND state IN ('pending', 'running')
         ORDER BY created_at ASC LIMIT 1`,
      )
      .get(taskId) as any | undefined;

    if (existing) {
      return rowToAutostartJob(existing);
    }

    const ts = nowIso();
    const id = uuidv4();
    db.prepare(
      "INSERT INTO autostart_jobs (id, task_id, trigger_kind, state, plan_id, run_id, error, created_at, updated_at, started_at, completed_at) VALUES (?, ?, ?, 'pending', NULL, NULL, NULL, ?, ?, NULL, NULL)",
    ).run(id, taskId, triggerKind, ts, ts);

    const row = db
      .prepare(`SELECT ${AUTOSTART_COLS} FROM autostart_jobs WHERE id = ?`)
      .get(id) as any;
    return rowToAutostartJob(row);
};

Db.prototype.claimNextPendingAutostartJob = function (): AutostartJob | null {
  const db = this.connect();
    let result: AutostartJob | null = null;

    const tx = db.transaction(() => {
      const nextRow = db
        .prepare(
          "SELECT id FROM autostart_jobs WHERE state = 'pending' ORDER BY created_at ASC LIMIT 1",
        )
        .get() as { id: string } | undefined;

      if (!nextRow) return;

      const ts = nowIso();
      db.prepare(
        "UPDATE autostart_jobs SET state = 'running', started_at = ?, updated_at = ? WHERE id = ?",
      ).run(ts, ts, nextRow.id);

      const row = db
        .prepare(`SELECT ${AUTOSTART_COLS} FROM autostart_jobs WHERE id = ?`)
        .get(nextRow.id) as any | undefined;

      if (row) {
        result = rowToAutostartJob(row);
      }
    });
    tx();

    return result;
};

Db.prototype.completeAutostartJob = function (
  jobId: string,
  planId?: string,
  runId?: string,
): void {
  const db = this.connect();
    const ts = nowIso();
    db.prepare(
      "UPDATE autostart_jobs SET state = 'done', plan_id = ?, run_id = ?, error = NULL, completed_at = ?, updated_at = ? WHERE id = ?",
    ).run(planId ?? null, runId ?? null, ts, ts, jobId);
};

Db.prototype.failAutostartJob = function (
  jobId: string,
  error: string,
  planId?: string,
  runId?: string,
): void {
  const db = this.connect();
    const ts = nowIso();
    db.prepare(
      "UPDATE autostart_jobs SET state = 'failed', plan_id = ?, run_id = ?, error = ?, completed_at = ?, updated_at = ? WHERE id = ?",
    ).run(planId ?? null, runId ?? null, error, ts, ts, jobId);
};

Db.prototype.requeueAutostartJob = function (
  jobId: string,
  error?: string,
): void {
  const db = this.connect();
    db.prepare(
      "UPDATE autostart_jobs SET state = 'pending', error = ?, updated_at = ?, started_at = NULL WHERE id = ?",
    ).run(error ?? null, nowIso(), jobId);
};

Db.prototype.getAutostartJobById = function (jobId: string): AutostartJob | null {
  const db = this.connect();
    const row = db
      .prepare(`SELECT ${AUTOSTART_COLS} FROM autostart_jobs WHERE id = ?`)
      .get(jobId) as any | undefined;
    return row ? rowToAutostartJob(row) : null;
};
