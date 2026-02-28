use rusqlite::OptionalExtension;
use anyhow::{Context, Result};
use rusqlite::params;
use uuid::Uuid;

use crate::models::AutostartJob;

use super::{Db, now_iso};

impl Db {
    pub fn enqueue_autostart_job(&self, task_id: &str, trigger_kind: &str) -> Result<AutostartJob> {
        let mut conn = self.connect()?;
        let tx = conn.transaction()?;

        let existing: Option<AutostartJob> = tx
            .query_row(
                r#"SELECT id, task_id, trigger_kind, state, plan_id, run_id, error, created_at, updated_at, started_at, completed_at
                   FROM autostart_jobs
                   WHERE task_id = ?1 AND state IN ('pending', 'running')
                   ORDER BY created_at ASC
                   LIMIT 1"#,
                [task_id],
                |row| {
                    Ok(AutostartJob {
                        id: row.get(0)?,
                        task_id: row.get(1)?,
                        trigger_kind: row.get(2)?,
                        state: row.get(3)?,
                        plan_id: row.get(4)?,
                        run_id: row.get(5)?,
                        error: row.get(6)?,
                        created_at: row.get(7)?,
                        updated_at: row.get(8)?,
                        started_at: row.get(9)?,
                        completed_at: row.get(10)?,
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
            "INSERT INTO autostart_jobs (id, task_id, trigger_kind, state, plan_id, run_id, error, created_at, updated_at, started_at, completed_at) VALUES (?1, ?2, ?3, 'pending', NULL, NULL, NULL, ?4, ?5, NULL, NULL)",
            params![id, task_id, trigger_kind, ts, ts],
        )?;
        tx.commit()?;
        self.get_autostart_job_by_id(&id)?
            .context("autostart job missing after insert")
    }

    pub fn claim_next_pending_autostart_job(&self) -> Result<Option<AutostartJob>> {
        let mut conn = self.connect()?;
        let tx = conn.transaction()?;
        let next_id: Option<String> = tx
            .query_row(
                "SELECT id FROM autostart_jobs WHERE state = 'pending' ORDER BY created_at ASC LIMIT 1",
                [],
                |row| row.get(0),
            )
            .optional()?;

        let Some(job_id) = next_id else {
            tx.commit()?;
            return Ok(None);
        };

        let ts = now_iso();
        tx.execute(
            "UPDATE autostart_jobs SET state = 'running', started_at = ?1, updated_at = ?1 WHERE id = ?2",
            params![ts, job_id],
        )?;

        let job = tx
            .query_row(
                r#"SELECT id, task_id, trigger_kind, state, plan_id, run_id, error, created_at, updated_at, started_at, completed_at
                   FROM autostart_jobs
                   WHERE id = ?1"#,
                [job_id],
                |row| {
                    Ok(AutostartJob {
                        id: row.get(0)?,
                        task_id: row.get(1)?,
                        trigger_kind: row.get(2)?,
                        state: row.get(3)?,
                        plan_id: row.get(4)?,
                        run_id: row.get(5)?,
                        error: row.get(6)?,
                        created_at: row.get(7)?,
                        updated_at: row.get(8)?,
                        started_at: row.get(9)?,
                        completed_at: row.get(10)?,
                    })
                },
            )
            .optional()?;
        tx.commit()?;
        Ok(job)
    }

    pub fn complete_autostart_job(
        &self,
        job_id: &str,
        plan_id: Option<&str>,
        run_id: Option<&str>,
    ) -> Result<()> {
        let conn = self.connect()?;
        let ts = now_iso();
        conn.execute(
            "UPDATE autostart_jobs SET state = 'done', plan_id = ?1, run_id = ?2, error = NULL, completed_at = ?3, updated_at = ?3 WHERE id = ?4",
            params![plan_id, run_id, ts, job_id],
        )?;
        Ok(())
    }

    pub fn fail_autostart_job(
        &self,
        job_id: &str,
        error: &str,
        plan_id: Option<&str>,
        run_id: Option<&str>,
    ) -> Result<()> {
        let conn = self.connect()?;
        let ts = now_iso();
        conn.execute(
            "UPDATE autostart_jobs SET state = 'failed', plan_id = ?1, run_id = ?2, error = ?3, completed_at = ?4, updated_at = ?4 WHERE id = ?5",
            params![plan_id, run_id, error, ts, job_id],
        )?;
        Ok(())
    }

    pub fn requeue_autostart_job(&self, job_id: &str, error: Option<&str>) -> Result<()> {
        let conn = self.connect()?;
        conn.execute(
            "UPDATE autostart_jobs SET state = 'pending', error = ?1, updated_at = ?2, started_at = NULL WHERE id = ?3",
            params![error, now_iso(), job_id],
        )?;
        Ok(())
    }

    pub fn get_autostart_job_by_id(&self, job_id: &str) -> Result<Option<AutostartJob>> {
        let conn = self.connect()?;
        conn.query_row(
            r#"SELECT id, task_id, trigger_kind, state, plan_id, run_id, error, created_at, updated_at, started_at, completed_at
               FROM autostart_jobs
               WHERE id = ?1"#,
            [job_id],
            |row| {
                Ok(AutostartJob {
                    id: row.get(0)?,
                    task_id: row.get(1)?,
                    trigger_kind: row.get(2)?,
                    state: row.get(3)?,
                    plan_id: row.get(4)?,
                    run_id: row.get(5)?,
                    error: row.get(6)?,
                    created_at: row.get(7)?,
                    updated_at: row.get(8)?,
                    started_at: row.get(9)?,
                    completed_at: row.get(10)?,
                })
            },
        )
        .optional()
        .map_err(anyhow::Error::from)
    }
}
