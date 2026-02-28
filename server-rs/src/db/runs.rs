use rusqlite::OptionalExtension;
use anyhow::{Context, Result};
use rusqlite::params;
use serde_json::Value;
use uuid::Uuid;

use crate::models::{Run, RunEvent};

use super::{Db, now_iso};

impl Db {
    pub fn create_run(
        &self,
        task_id: &str,
        plan_id: &str,
        status: &str,
        branch_name: &str,
        agent_profile_id: Option<&str>,
        worktree_path: Option<&str>,
    ) -> Result<Run> {
        let conn = self.connect()?;
        let id = Uuid::new_v4().to_string();
        let ts = now_iso();
        let started_at = if status == "running" {
            Some(ts.clone())
        } else {
            None
        };
        conn.execute(
            "INSERT INTO runs (id, task_id, plan_id, status, branch_name, agent_profile_id, pid, exit_code, worktree_path, started_at, completed_at, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, NULL, NULL, ?7, ?8, NULL, ?9, ?10)",
            params![id, task_id, plan_id, status, branch_name, agent_profile_id, worktree_path, started_at, ts, ts],
        )?;
        self.get_run_by_id(&id)?.context("run missing after create")
    }

    pub fn update_run_status(&self, run_id: &str, status: &str, completed: bool) -> Result<()> {
        let conn = self.connect()?;
        let completed_at: Option<String> = if completed { Some(now_iso()) } else { None };
        conn.execute(
            "UPDATE runs SET status = ?1, completed_at = ?2, updated_at = ?3 WHERE id = ?4",
            params![status, completed_at, now_iso(), run_id],
        )?;
        Ok(())
    }

    pub fn get_run_by_id(&self, run_id: &str) -> Result<Option<Run>> {
        let conn = self.connect()?;
        conn.query_row(
            "SELECT id, task_id, plan_id, status, branch_name, agent_profile_id, pid, exit_code, agent_session_id, review_comment_id, worktree_path, started_at, completed_at, created_at, updated_at FROM runs WHERE id = ?1",
            [run_id],
            |row| {
                Ok(Run {
                    id: row.get(0)?,
                    task_id: row.get(1)?,
                    plan_id: row.get(2)?,
                    status: row.get(3)?,
                    branch_name: row.get(4)?,
                    agent_profile_id: row.get(5)?,
                    pid: row.get(6)?,
                    exit_code: row.get(7)?,
                    agent_session_id: row.get(8)?,
                    review_comment_id: row.get(9)?,
                    worktree_path: row.get(10)?,
                    started_at: row.get(11)?,
                    completed_at: row.get(12)?,
                    created_at: row.get(13)?,
                    updated_at: row.get(14)?,
                })
            },
        )
        .optional()
        .map_err(anyhow::Error::from)
    }

    pub fn add_run_event(&self, run_id: &str, event_type: &str, payload: &Value) -> Result<()> {
        let conn = self.connect()?;
        conn.execute(
            "INSERT INTO events (id, run_id, type, payload_json, created_at) VALUES (?1, ?2, ?3, ?4, ?5)",
            params![
                Uuid::new_v4().to_string(),
                run_id,
                event_type,
                payload.to_string(),
                now_iso()
            ],
        )?;
        Ok(())
    }

    pub fn list_run_events(&self, run_id: &str) -> Result<Vec<RunEvent>> {
        let conn = self.connect()?;
        let mut stmt = conn.prepare(
            "SELECT id, run_id, type, payload_json, created_at FROM events WHERE run_id = ?1 ORDER BY created_at ASC",
        )?;
        let rows = stmt.query_map([run_id], |row| {
            let payload_raw: String = row.get(3)?;
            Ok(RunEvent {
                id: row.get(0)?,
                run_id: row.get(1)?,
                r#type: row.get(2)?,
                payload: serde_json::from_str(&payload_raw).unwrap_or(Value::Null),
                created_at: row.get(4)?,
            })
        })?;
        rows.collect::<std::result::Result<Vec<_>, _>>()
            .map_err(anyhow::Error::from)
    }

    pub fn update_run_pid(&self, run_id: &str, pid: i64) -> Result<()> {
        let conn = self.connect()?;
        conn.execute(
            "UPDATE runs SET pid = ?1, updated_at = ?2 WHERE id = ?3",
            params![pid, now_iso(), run_id],
        )?;
        Ok(())
    }

    pub fn update_run_exit_code(&self, run_id: &str, exit_code: Option<i64>) -> Result<()> {
        let conn = self.connect()?;
        conn.execute(
            "UPDATE runs SET exit_code = ?1, updated_at = ?2 WHERE id = ?3",
            params![exit_code, now_iso(), run_id],
        )?;
        Ok(())
    }

    pub fn get_latest_run_by_task(&self, task_id: &str) -> Result<Option<Run>> {
        let conn = self.connect()?;
        conn.query_row(
            "SELECT id, task_id, plan_id, status, branch_name, agent_profile_id, pid, exit_code, agent_session_id, review_comment_id, worktree_path, started_at, completed_at, created_at, updated_at FROM runs WHERE task_id = ?1 ORDER BY created_at DESC LIMIT 1",
            [task_id],
            |row| {
                Ok(Run {
                    id: row.get(0)?,
                    task_id: row.get(1)?,
                    plan_id: row.get(2)?,
                    status: row.get(3)?,
                    branch_name: row.get(4)?,
                    agent_profile_id: row.get(5)?,
                    pid: row.get(6)?,
                    exit_code: row.get(7)?,
                    agent_session_id: row.get(8)?,
                    review_comment_id: row.get(9)?,
                    worktree_path: row.get(10)?,
                    started_at: row.get(11)?,
                    completed_at: row.get(12)?,
                    created_at: row.get(13)?,
                    updated_at: row.get(14)?,
                })
            },
        )
        .optional()
        .map_err(anyhow::Error::from)
    }

    pub fn update_run_session_id(&self, run_id: &str, session_id: &str) -> Result<()> {
        let conn = self.connect()?;
        conn.execute(
            "UPDATE runs SET agent_session_id = ?1, updated_at = ?2 WHERE id = ?3",
            params![session_id, now_iso(), run_id],
        )?;
        Ok(())
    }

    pub fn update_run_worktree_path(&self, run_id: &str, worktree_path: &str) -> Result<()> {
        let conn = self.connect()?;
        conn.execute(
            "UPDATE runs SET worktree_path = ?1, updated_at = ?2 WHERE id = ?3",
            params![worktree_path, now_iso(), run_id],
        )?;
        Ok(())
    }

    pub fn update_run_review_comment_id(&self, run_id: &str, review_comment_id: &str) -> Result<()> {
        let conn = self.connect()?;
        conn.execute(
            "UPDATE runs SET review_comment_id = ?1, updated_at = ?2 WHERE id = ?3",
            params![review_comment_id, now_iso(), run_id],
        )?;
        Ok(())
    }
}
