use rusqlite::OptionalExtension;
use anyhow::{Context, Result};
use rusqlite::params;
use serde_json::Value;
use uuid::Uuid;

use crate::models::{Plan, PlanWithParsed};

use super::{Db, now_iso};

impl Db {
    pub fn create_plan(
        &self,
        task_id: &str,
        status: &str,
        plan_markdown: &str,
        plan_json: &Value,
        tasklist_json: &Value,
        tasklist_schema_version: i64,
        generation_mode: &str,
        validation_errors_json: Option<&Value>,
        created_by: &str,
    ) -> Result<Plan> {
        let conn = self.connect()?;
        let current_version: Option<i64> = conn
            .query_row(
                "SELECT version FROM plans WHERE task_id = ?1 ORDER BY version DESC LIMIT 1",
                [task_id],
                |row| row.get(0),
            )
            .optional()?;
        let version = current_version.unwrap_or(0) + 1;
        let ts = now_iso();
        let id = Uuid::new_v4().to_string();
        conn.execute(
            "INSERT INTO plans (id, task_id, version, status, plan_markdown, plan_json, tasklist_json, tasklist_schema_version, generation_mode, validation_errors_json, created_by, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)",
            params![
                id,
                task_id,
                version,
                status,
                plan_markdown,
                plan_json.to_string(),
                tasklist_json.to_string(),
                tasklist_schema_version,
                generation_mode,
                validation_errors_json.map(Value::to_string),
                created_by,
                ts,
                ts
            ],
        )?;
        self.get_plan_by_id(&id)?
            .context("plan missing after insert")
            .map(|p| Plan {
                id: p.id,
                task_id: p.task_id,
                version: p.version,
                status: p.status,
                plan_markdown: p.plan_markdown,
                plan_json: p.plan.to_string(),
                tasklist_json: p.tasklist.to_string(),
                tasklist_schema_version: p.tasklist_schema_version,
                generation_mode: p.generation_mode,
                validation_errors_json: p.validation_errors.map(|v| v.to_string()),
                created_by: p.created_by,
                created_at: p.created_at,
                updated_at: p.updated_at,
            })
    }

    pub fn get_next_plan_version(&self, task_id: &str) -> Result<i64> {
        let conn = self.connect()?;
        let current_version: Option<i64> = conn
            .query_row(
                "SELECT version FROM plans WHERE task_id = ?1 ORDER BY version DESC LIMIT 1",
                [task_id],
                |row| row.get(0),
            )
            .optional()?;
        Ok(current_version.unwrap_or(0) + 1)
    }

    pub fn list_plans_by_task(&self, task_id: &str) -> Result<Vec<PlanWithParsed>> {
        let conn = self.connect()?;
        let mut stmt = conn.prepare(
            "SELECT id, task_id, version, status, plan_markdown, plan_json, tasklist_json, tasklist_schema_version, generation_mode, validation_errors_json, created_by, created_at, updated_at FROM plans WHERE task_id = ?1 ORDER BY version DESC",
        )?;
        let rows = stmt.query_map([task_id], |row| {
            let plan_raw: String = row.get(5)?;
            let tasklist_raw: String = row.get(6)?;
            let validation_errors_raw: Option<String> = row.get(9)?;
            Ok(PlanWithParsed {
                id: row.get(0)?,
                task_id: row.get(1)?,
                version: row.get(2)?,
                status: row.get(3)?,
                plan_markdown: row.get(4)?,
                plan: serde_json::from_str(&plan_raw).unwrap_or(Value::Null),
                tasklist: serde_json::from_str(&tasklist_raw).unwrap_or(Value::Null),
                tasklist_schema_version: row.get(7)?,
                generation_mode: row.get(8)?,
                validation_errors: validation_errors_raw
                    .and_then(|raw| serde_json::from_str(&raw).ok()),
                created_by: row.get(10)?,
                created_at: row.get(11)?,
                updated_at: row.get(12)?,
            })
        })?;
        rows.collect::<std::result::Result<Vec<_>, _>>()
            .map_err(anyhow::Error::from)
    }

    pub fn get_plan_by_id(&self, plan_id: &str) -> Result<Option<PlanWithParsed>> {
        let conn = self.connect()?;
        conn.query_row(
            "SELECT id, task_id, version, status, plan_markdown, plan_json, tasklist_json, tasklist_schema_version, generation_mode, validation_errors_json, created_by, created_at, updated_at FROM plans WHERE id = ?1",
            [plan_id],
            |row| {
                let plan_raw: String = row.get(5)?;
                let tasklist_raw: String = row.get(6)?;
                let validation_errors_raw: Option<String> = row.get(9)?;
                Ok(PlanWithParsed {
                    id: row.get(0)?,
                    task_id: row.get(1)?,
                    version: row.get(2)?,
                    status: row.get(3)?,
                    plan_markdown: row.get(4)?,
                    plan: serde_json::from_str(&plan_raw).unwrap_or(Value::Null),
                    tasklist: serde_json::from_str(&tasklist_raw).unwrap_or(Value::Null),
                    tasklist_schema_version: row.get(7)?,
                    generation_mode: row.get(8)?,
                    validation_errors: validation_errors_raw
                        .and_then(|raw| serde_json::from_str(&raw).ok()),
                    created_by: row.get(10)?,
                    created_at: row.get(11)?,
                    updated_at: row.get(12)?,
                })
            },
        )
        .optional()
        .map_err(anyhow::Error::from)
    }

    pub fn update_plan_status(&self, plan_id: &str, status: &str) -> Result<()> {
        let conn = self.connect()?;
        conn.execute(
            "UPDATE plans SET status = ?1, updated_at = ?2 WHERE id = ?3",
            params![status, now_iso(), plan_id],
        )?;
        Ok(())
    }

    pub fn add_plan_action(
        &self,
        plan_id: &str,
        action: &str,
        comment: Option<&str>,
        actor: &str,
    ) -> Result<()> {
        let conn = self.connect()?;
        conn.execute(
            "INSERT INTO plan_actions (id, plan_id, action, comment, actor, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![Uuid::new_v4().to_string(), plan_id, action, comment, actor, now_iso()],
        )?;
        Ok(())
    }
}
