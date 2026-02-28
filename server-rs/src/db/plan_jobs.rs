use rusqlite::OptionalExtension;
use anyhow::{Context, Result};
use rusqlite::params;
use uuid::Uuid;

use crate::models::PlanJob;

use super::{Db, now_iso};

impl Db {
    pub fn create_plan_job(
        &self,
        task_id: &str,
        mode: &str,
        revision_comment: Option<&str>,
    ) -> Result<PlanJob> {
        let mut conn = self.connect()?;
        let tx = conn.transaction()?;

        let existing: Option<PlanJob> = tx
            .query_row(
                r#"SELECT id, task_id, mode, status, revision_comment, plan_id, error, agent_session_id, created_at, updated_at, started_at, completed_at
                   FROM plan_jobs
                   WHERE task_id = ?1 AND status IN ('pending', 'running')
                   ORDER BY created_at DESC
                   LIMIT 1"#,
                [task_id],
                |row| {
                    Ok(PlanJob {
                        id: row.get(0)?,
                        task_id: row.get(1)?,
                        mode: row.get(2)?,
                        status: row.get(3)?,
                        revision_comment: row.get(4)?,
                        plan_id: row.get(5)?,
                        error: row.get(6)?,
                        agent_session_id: row.get(7)?,
                        created_at: row.get(8)?,
                        updated_at: row.get(9)?,
                        started_at: row.get(10)?,
                        completed_at: row.get(11)?,
                    })
                },
            )
            .optional()?;

        if let Some(job) = existing {
            tx.commit()?;
            return Ok(job);
        }

        let ts = now_iso();
        let id = Uuid::new_v4().to_string();
        tx.execute(
            "INSERT INTO plan_jobs (id, task_id, mode, status, revision_comment, plan_id, error, agent_session_id, created_at, updated_at, started_at, completed_at) VALUES (?1, ?2, ?3, 'pending', ?4, NULL, NULL, NULL, ?5, ?5, NULL, NULL)",
            params![id, task_id, mode, revision_comment, ts],
        )?;
        tx.commit()?;
        self.get_plan_job_by_id(&id)?
            .context("plan job missing after insert")
    }

    pub fn mark_plan_job_running(&self, job_id: &str) -> Result<()> {
        let conn = self.connect()?;
        let ts = now_iso();
        conn.execute(
            "UPDATE plan_jobs SET status = 'running', started_at = COALESCE(started_at, ?1), updated_at = ?1 WHERE id = ?2",
            params![ts, job_id],
        )?;
        Ok(())
    }

    pub fn touch_plan_job(&self, job_id: &str) -> Result<()> {
        let conn = self.connect()?;
        conn.execute(
            "UPDATE plan_jobs SET updated_at = ?1 WHERE id = ?2",
            params![now_iso(), job_id],
        )?;
        Ok(())
    }

    pub fn complete_plan_job(&self, job_id: &str, plan_id: Option<&str>, agent_session_id: Option<&str>) -> Result<()> {
        let conn = self.connect()?;
        let ts = now_iso();
        conn.execute(
            "UPDATE plan_jobs SET status = 'done', plan_id = ?1, agent_session_id = ?2, error = NULL, completed_at = ?3, updated_at = ?3 WHERE id = ?4",
            params![plan_id, agent_session_id, ts, job_id],
        )?;
        Ok(())
    }

    pub fn fail_plan_job(&self, job_id: &str, error: &str, plan_id: Option<&str>) -> Result<()> {
        let conn = self.connect()?;
        let ts = now_iso();
        conn.execute(
            "UPDATE plan_jobs SET status = 'failed', plan_id = ?1, error = ?2, completed_at = ?3, updated_at = ?3 WHERE id = ?4",
            params![plan_id, error, ts, job_id],
        )?;
        Ok(())
    }

    pub fn get_plan_job_by_id(&self, job_id: &str) -> Result<Option<PlanJob>> {
        let conn = self.connect()?;
        conn.query_row(
            r#"SELECT id, task_id, mode, status, revision_comment, plan_id, error, agent_session_id, created_at, updated_at, started_at, completed_at
               FROM plan_jobs
               WHERE id = ?1"#,
            [job_id],
            |row| {
                Ok(PlanJob {
                    id: row.get(0)?,
                    task_id: row.get(1)?,
                    mode: row.get(2)?,
                    status: row.get(3)?,
                    revision_comment: row.get(4)?,
                    plan_id: row.get(5)?,
                    error: row.get(6)?,
                    agent_session_id: row.get(7)?,
                    created_at: row.get(8)?,
                    updated_at: row.get(9)?,
                    started_at: row.get(10)?,
                    completed_at: row.get(11)?,
                })
            },
        )
        .optional()
        .map_err(anyhow::Error::from)
    }

    pub fn get_latest_plan_job_by_task(&self, task_id: &str) -> Result<Option<PlanJob>> {
        let conn = self.connect()?;
        conn.query_row(
            r#"SELECT id, task_id, mode, status, revision_comment, plan_id, error, agent_session_id, created_at, updated_at, started_at, completed_at
               FROM plan_jobs
               WHERE task_id = ?1
               ORDER BY created_at DESC
               LIMIT 1"#,
            [task_id],
            |row| {
                Ok(PlanJob {
                    id: row.get(0)?,
                    task_id: row.get(1)?,
                    mode: row.get(2)?,
                    status: row.get(3)?,
                    revision_comment: row.get(4)?,
                    plan_id: row.get(5)?,
                    error: row.get(6)?,
                    agent_session_id: row.get(7)?,
                    created_at: row.get(8)?,
                    updated_at: row.get(9)?,
                    started_at: row.get(10)?,
                    completed_at: row.get(11)?,
                })
            },
        )
        .optional()
        .map_err(anyhow::Error::from)
    }

    pub fn get_latest_completed_plan_job_session(&self, task_id: &str) -> Result<Option<String>> {
        let conn = self.connect()?;
        conn.query_row(
            "SELECT agent_session_id FROM plan_jobs WHERE task_id = ?1 AND status = 'done' AND agent_session_id IS NOT NULL ORDER BY completed_at DESC LIMIT 1",
            [task_id],
            |row| row.get(0),
        )
        .optional()
        .map_err(anyhow::Error::from)
    }
}
