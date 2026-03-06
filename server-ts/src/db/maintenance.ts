import type { ClearPipelineResult } from '../models.js';
import { Db, nowIso } from './index.js';

declare module './index.js' {
  interface Db {
    hasRunningRunForRepo(repoId: string): boolean;
    hasRunningRunForTask(taskId: string): boolean;
    failStaleRunningRuns(): number;
    failStaleRunningPlanJobs(): number;
    resetStalePlanGeneratingTasks(): number;
    requeueStaleRunningAutostartJobs(): number;
    clearTaskPipeline(taskId: string): ClearPipelineResult;
    clearAllPipelines(): ClearPipelineResult;
  }
}

Db.prototype.hasRunningRunForRepo = function (repoId: string): boolean {
  const db = this.connect();
    const row = db
      .prepare(
        `SELECT r.id FROM runs r
         INNER JOIN tasks t ON t.id = r.task_id
         WHERE t.repo_id = ? AND r.status = 'running'
         ORDER BY r.created_at DESC LIMIT 1`,
      )
      .get(repoId) as any | undefined;
    return !!row;
};

Db.prototype.hasRunningRunForTask = function (taskId: string): boolean {
  const db = this.connect();
    const row = db
      .prepare("SELECT id FROM runs WHERE task_id = ? AND status = 'running' LIMIT 1")
      .get(taskId) as any | undefined;
    return !!row;
};

Db.prototype.failStaleRunningRuns = function (): number {
  const db = this.connect();
    const ts = nowIso();
    const result = db
      .prepare(
        "UPDATE runs SET status = 'failed', completed_at = ?, updated_at = ? WHERE status = 'running'",
      )
      .run(ts, ts);

    db.prepare(
      "UPDATE tasks SET status = 'FAILED', updated_at = ? WHERE status = 'IN_PROGRESS' AND id IN (SELECT task_id FROM runs WHERE status = 'failed' AND completed_at = ?)",
    ).run(ts, ts);

    return Number(result.changes);
};

Db.prototype.failStaleRunningPlanJobs = function (): number {
  const db = this.connect();
    const ts = nowIso();
    const result = db
      .prepare(
        "UPDATE plan_jobs SET status = 'failed', error = COALESCE(error, 'Recovered stale running plan job on startup'), completed_at = ?, updated_at = ? WHERE status = 'running'",
      )
      .run(ts, ts);
    return Number(result.changes);
};

Db.prototype.resetStalePlanGeneratingTasks = function (): number {
  const db = this.connect();
    const ts = nowIso();
    const result = db
      .prepare(
        `UPDATE tasks SET status = 'TODO', updated_at = ?
         WHERE status = 'PLAN_GENERATING'
         AND id NOT IN (
           SELECT task_id FROM plan_jobs WHERE status IN ('pending', 'running')
         )`,
      )
      .run(ts);
    return Number(result.changes);
};

Db.prototype.requeueStaleRunningAutostartJobs = function (): number {
  const db = this.connect();
    const ts = nowIso();
    const result = db
      .prepare(
        "UPDATE autostart_jobs SET state = 'pending', error = COALESCE(error, 'Recovered stale running job on startup'), updated_at = ?, started_at = NULL WHERE state = 'running'",
      )
      .run(ts);
    return Number(result.changes);
};

Db.prototype.clearTaskPipeline = function (taskId: string): ClearPipelineResult {
  const db = this.connect();
    const ts = nowIso();

    const planJobsResult = db
      .prepare(
        "UPDATE plan_jobs SET status = 'failed', error = 'Manually cleared by user', completed_at = ?, updated_at = ? WHERE task_id = ? AND status IN ('pending', 'running')",
      )
      .run(ts, ts, taskId);

    const autostartResult = db
      .prepare(
        "UPDATE autostart_jobs SET state = 'failed', error = 'Manually cleared by user', completed_at = ?, updated_at = ? WHERE task_id = ? AND state IN ('pending', 'running')",
      )
      .run(ts, ts, taskId);

    const taskResult = db
      .prepare(
        "UPDATE tasks SET status = 'TODO', last_pipeline_error = 'Pipeline manually cleared', last_pipeline_at = ?, updated_at = ? WHERE id = ? AND status IN ('PLAN_GENERATING', 'PLAN_DRAFTED', 'PLAN_APPROVED')",
      )
      .run(ts, ts, taskId);

    return {
      plan_jobs_failed: Number(planJobsResult.changes),
      autostart_jobs_failed: Number(autostartResult.changes),
      task_reset: Number(taskResult.changes) > 0,
    };
};

Db.prototype.clearAllPipelines = function (): ClearPipelineResult {
  const db = this.connect();
    const ts = nowIso();

    const planJobsResult = db
      .prepare(
        "UPDATE plan_jobs SET status = 'failed', error = 'Manually cleared by user', completed_at = ?, updated_at = ? WHERE status IN ('pending', 'running')",
      )
      .run(ts, ts);

    const autostartResult = db
      .prepare(
        "UPDATE autostart_jobs SET state = 'failed', error = 'Manually cleared by user', completed_at = ?, updated_at = ? WHERE state IN ('pending', 'running')",
      )
      .run(ts, ts);

    const taskResult = db
      .prepare(
        "UPDATE tasks SET status = 'TODO', last_pipeline_error = 'Pipeline manually cleared', last_pipeline_at = ?, updated_at = ? WHERE status = 'PLAN_GENERATING'",
      )
      .run(ts, ts);

    return {
      plan_jobs_failed: Number(planJobsResult.changes),
      autostart_jobs_failed: Number(autostartResult.changes),
      task_reset: Number(taskResult.changes) > 0,
    };
};
