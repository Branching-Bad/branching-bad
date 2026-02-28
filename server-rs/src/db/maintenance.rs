use rusqlite::OptionalExtension;
use anyhow::Result;
use rusqlite::params;

use crate::models::ClearPipelineResult;

use super::{Db, now_iso};

impl Db {
    pub fn has_running_run_for_repo(&self, repo_id: &str) -> Result<bool> {
        let conn = self.connect()?;
        let running_id: Option<String> = conn
            .query_row(
                r#"SELECT r.id
                   FROM runs r
                   INNER JOIN tasks t ON t.id = r.task_id
                   WHERE t.repo_id = ?1 AND r.status = 'running'
                   ORDER BY r.created_at DESC
                   LIMIT 1"#,
                [repo_id],
                |row| row.get(0),
            )
            .optional()?;
        Ok(running_id.is_some())
    }

    pub fn fail_stale_running_runs(&self) -> Result<usize> {
        let conn = self.connect()?;
        let ts = now_iso();
        let count = conn.execute(
            "UPDATE runs SET status = 'failed', completed_at = ?1, updated_at = ?1 WHERE status = 'running'",
            params![ts],
        )?;
        conn.execute(
            "UPDATE tasks SET status = 'FAILED', updated_at = ?1 WHERE status = 'IN_PROGRESS' AND id IN (SELECT task_id FROM runs WHERE status = 'failed' AND completed_at = ?1)",
            params![ts],
        )?;
        Ok(count)
    }

    pub fn fail_stale_running_plan_jobs(&self) -> Result<usize> {
        let conn = self.connect()?;
        let ts = now_iso();
        let count = conn.execute(
            "UPDATE plan_jobs SET status = 'failed', error = COALESCE(error, 'Recovered stale running plan job on startup'), completed_at = ?1, updated_at = ?1 WHERE status = 'running'",
            params![ts],
        )?;
        Ok(count)
    }

    pub fn reset_stale_plan_generating_tasks(&self) -> Result<usize> {
        let conn = self.connect()?;
        let ts = now_iso();
        let count = conn.execute(
            r#"UPDATE tasks SET status = 'TODO', updated_at = ?1
               WHERE status = 'PLAN_GENERATING'
               AND id NOT IN (
                   SELECT task_id FROM plan_jobs WHERE status IN ('pending', 'running')
               )"#,
            params![ts],
        )?;
        Ok(count)
    }

    pub fn requeue_stale_running_autostart_jobs(&self) -> Result<usize> {
        let conn = self.connect()?;
        let ts = now_iso();
        let count = conn.execute(
            "UPDATE autostart_jobs SET state = 'pending', error = COALESCE(error, 'Recovered stale running job on startup'), updated_at = ?1, started_at = NULL WHERE state = 'running'",
            params![ts],
        )?;
        Ok(count)
    }

    pub fn clear_task_pipeline(&self, task_id: &str) -> Result<ClearPipelineResult> {
        let conn = self.connect()?;
        let ts = now_iso();

        let plan_jobs_failed = conn.execute(
            "UPDATE plan_jobs SET status = 'failed', error = 'Manually cleared by user', completed_at = ?1, updated_at = ?1 WHERE task_id = ?2 AND status IN ('pending', 'running')",
            params![ts, task_id],
        )?;

        let autostart_jobs_failed = conn.execute(
            "UPDATE autostart_jobs SET state = 'failed', error = 'Manually cleared by user', completed_at = ?1, updated_at = ?1 WHERE task_id = ?2 AND state IN ('pending', 'running')",
            params![ts, task_id],
        )?;

        let task_reset = conn.execute(
            "UPDATE tasks SET status = 'TODO', last_pipeline_error = 'Pipeline manually cleared', last_pipeline_at = ?1, updated_at = ?1 WHERE id = ?2 AND status IN ('PLAN_GENERATING', 'PLAN_DRAFTED', 'PLAN_APPROVED')",
            params![ts, task_id],
        )?;

        Ok(ClearPipelineResult {
            plan_jobs_failed,
            autostart_jobs_failed,
            task_reset: task_reset > 0,
        })
    }

    pub fn clear_all_pipelines(&self) -> Result<ClearPipelineResult> {
        let conn = self.connect()?;
        let ts = now_iso();

        let plan_jobs_failed = conn.execute(
            "UPDATE plan_jobs SET status = 'failed', error = 'Manually cleared by user', completed_at = ?1, updated_at = ?1 WHERE status IN ('pending', 'running')",
            params![ts],
        )?;

        let autostart_jobs_failed = conn.execute(
            "UPDATE autostart_jobs SET state = 'failed', error = 'Manually cleared by user', completed_at = ?1, updated_at = ?1 WHERE state IN ('pending', 'running')",
            params![ts],
        )?;

        let task_reset_count = conn.execute(
            "UPDATE tasks SET status = 'TODO', last_pipeline_error = 'Pipeline manually cleared', last_pipeline_at = ?1, updated_at = ?1 WHERE status = 'PLAN_GENERATING'",
            params![ts],
        )?;

        Ok(ClearPipelineResult {
            plan_jobs_failed,
            autostart_jobs_failed,
            task_reset: task_reset_count > 0,
        })
    }
}
