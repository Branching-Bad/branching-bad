import { v4 as uuidv4 } from 'uuid';
import type { PlanJob } from '../models.js';
import { Db, nowIso } from './index.js';

declare module './index.js' {
  interface Db {
    createPlanJob(taskId: string, mode: string, revisionComment?: string): PlanJob;
    markPlanJobRunning(jobId: string): void;
    touchPlanJob(jobId: string): void;
    completePlanJob(jobId: string, planId?: string, agentSessionId?: string): void;
    failPlanJob(jobId: string, error: string, planId?: string): void;
    getPlanJobById(jobId: string): PlanJob | null;
    getLatestPlanJobByTask(taskId: string): PlanJob | null;
    getLatestCompletedPlanJobSession(taskId: string): string | null;
  }
}

const PLAN_JOB_COLS =
  'id, task_id, mode, status, revision_comment, plan_id, error, agent_session_id, created_at, updated_at, started_at, completed_at';

function rowToPlanJob(row: any): PlanJob {
  return {
    id: row.id,
    task_id: row.task_id,
    mode: row.mode,
    status: row.status,
    revision_comment: row.revision_comment,
    plan_id: row.plan_id,
    error: row.error,
    agent_session_id: row.agent_session_id,
    created_at: row.created_at,
    updated_at: row.updated_at,
    started_at: row.started_at,
    completed_at: row.completed_at,
  };
}

Db.prototype.createPlanJob = function (
  taskId: string,
  mode: string,
  revisionComment?: string,
): PlanJob {
  const db = this.connect();
    const existing = db
      .prepare(
        `SELECT ${PLAN_JOB_COLS} FROM plan_jobs
         WHERE task_id = ? AND status IN ('pending', 'running')
         ORDER BY created_at DESC LIMIT 1`,
      )
      .get(taskId) as any | undefined;

    if (existing) {
      return rowToPlanJob(existing);
    }

    const ts = nowIso();
    const id = uuidv4();
    db.prepare(
      "INSERT INTO plan_jobs (id, task_id, mode, status, revision_comment, plan_id, error, agent_session_id, created_at, updated_at, started_at, completed_at) VALUES (?, ?, ?, 'pending', ?, NULL, NULL, NULL, ?, ?, NULL, NULL)",
    ).run(id, taskId, mode, revisionComment ?? null, ts, ts);

    const row = db
      .prepare(`SELECT ${PLAN_JOB_COLS} FROM plan_jobs WHERE id = ?`)
      .get(id) as any;
    return rowToPlanJob(row);
};

Db.prototype.markPlanJobRunning = function (jobId: string): void {
  const db = this.connect();
    const ts = nowIso();
    db.prepare(
      "UPDATE plan_jobs SET status = 'running', started_at = COALESCE(started_at, ?), updated_at = ? WHERE id = ?",
    ).run(ts, ts, jobId);
};

Db.prototype.touchPlanJob = function (jobId: string): void {
  const db = this.connect();
    db.prepare('UPDATE plan_jobs SET updated_at = ? WHERE id = ?').run(nowIso(), jobId);
};

Db.prototype.completePlanJob = function (
  jobId: string,
  planId?: string,
  agentSessionId?: string,
): void {
  const db = this.connect();
    const ts = nowIso();
    db.prepare(
      "UPDATE plan_jobs SET status = 'done', plan_id = ?, agent_session_id = ?, error = NULL, completed_at = ?, updated_at = ? WHERE id = ?",
    ).run(planId ?? null, agentSessionId ?? null, ts, ts, jobId);
};

Db.prototype.failPlanJob = function (
  jobId: string,
  error: string,
  planId?: string,
): void {
  const db = this.connect();
    const ts = nowIso();
    db.prepare(
      "UPDATE plan_jobs SET status = 'failed', plan_id = ?, error = ?, completed_at = ?, updated_at = ? WHERE id = ?",
    ).run(planId ?? null, error, ts, ts, jobId);
};

Db.prototype.getPlanJobById = function (jobId: string): PlanJob | null {
  const db = this.connect();
    const row = db
      .prepare(`SELECT ${PLAN_JOB_COLS} FROM plan_jobs WHERE id = ?`)
      .get(jobId) as any | undefined;
    return row ? rowToPlanJob(row) : null;
};

Db.prototype.getLatestPlanJobByTask = function (taskId: string): PlanJob | null {
  const db = this.connect();
    const row = db
      .prepare(
        `SELECT ${PLAN_JOB_COLS} FROM plan_jobs WHERE task_id = ? ORDER BY created_at DESC LIMIT 1`,
      )
      .get(taskId) as any | undefined;
    return row ? rowToPlanJob(row) : null;
};

Db.prototype.getLatestCompletedPlanJobSession = function (
  taskId: string,
): string | null {
  const db = this.connect();
    const row = db
      .prepare(
        "SELECT agent_session_id FROM plan_jobs WHERE task_id = ? AND status = 'done' AND agent_session_id IS NOT NULL ORDER BY completed_at DESC LIMIT 1",
      )
      .get(taskId) as { agent_session_id: string } | undefined;
    return row?.agent_session_id ?? null;
};
