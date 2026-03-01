use anyhow::{Context, Result};
use rusqlite::{OptionalExtension, params};
use serde_json::Value;
use uuid::Uuid;

use crate::models::{CreateTaskPayload, TaskWithPayload};

use super::{Db, UpsertTaskTransition, UpsertTasksResult, now_iso};

impl Db {
    pub fn upsert_tasks(
        &self,
        repo_id: &str,
        jira_account_id: &str,
        jira_board_id: &str,
        tasks: &[crate::provider::jira::JiraIssueForTask],
    ) -> Result<UpsertTasksResult> {
        if tasks.is_empty() {
            return Ok(UpsertTasksResult {
                synced: 0,
                transitions: Vec::new(),
            });
        }
        let mut conn = self.connect()?;
        let tx = conn.transaction()?;
        let ts = now_iso();
        let mut transitions = Vec::new();

        for task in tasks {
            let existing: Option<(String, String)> = tx
                .query_row(
                    "SELECT id, status FROM tasks WHERE jira_account_id = ?1 AND jira_issue_key = ?2",
                    params![jira_account_id, task.jira_issue_key],
                    |row| Ok((row.get(0)?, row.get(1)?)),
                )
                .optional()?;
            let task_id = existing
                .as_ref()
                .map(|(id, _)| id.clone())
                .unwrap_or_else(|| Uuid::new_v4().to_string());
            tx.execute(
                r#"INSERT INTO tasks (
                     id, repo_id, jira_account_id, jira_board_id, jira_issue_key, title,
                     description, assignee, status, priority, source, require_plan, auto_start,
                     auto_approve_plan, last_pipeline_error, last_pipeline_at, payload_json,
                     created_at, updated_at
                   ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, 'jira', 1, 0, 0, NULL, NULL, ?11, ?12, ?13)
                   ON CONFLICT(jira_account_id, jira_issue_key)
                   DO UPDATE SET
                     repo_id = excluded.repo_id,
                     jira_board_id = excluded.jira_board_id,
                     title = excluded.title,
                     description = excluded.description,
                     assignee = excluded.assignee,
                     priority = excluded.priority,
                     source = excluded.source,
                     payload_json = excluded.payload_json,
                     updated_at = excluded.updated_at"#,
                params![
                    task_id,
                    repo_id,
                    jira_account_id,
                    jira_board_id,
                    task.jira_issue_key,
                    task.title,
                    task.description,
                    task.assignee,
                    task.status,
                    task.priority,
                    task.payload.to_string(),
                    ts,
                    ts,
                ],
            )?;

            transitions.push(UpsertTaskTransition {
                task_id,
                is_new: existing.is_none(),
                previous_status: existing.as_ref().map(|(_, status)| status.clone()),
                current_status: existing
                    .as_ref()
                    .map(|(_, status)| status.clone())
                    .unwrap_or_else(|| task.status.clone()),
            });
        }
        tx.commit()?;
        Ok(UpsertTasksResult {
            synced: tasks.len(),
            transitions,
        })
    }

    pub fn list_tasks_by_repo(&self, repo_id: &str) -> Result<Vec<TaskWithPayload>> {
        let conn = self.connect()?;
        let mut stmt = conn.prepare(
            "SELECT id, repo_id, jira_account_id, jira_board_id, jira_issue_key, title, description, assignee, status, priority, source, require_plan, auto_start, auto_approve_plan, use_worktree, last_pipeline_error, last_pipeline_at, agent_profile_id, pr_url, pr_number, payload_json, created_at, updated_at FROM tasks WHERE repo_id = ?1 ORDER BY updated_at DESC",
        )?;
        let rows = stmt.query_map([repo_id], |row| {
            let payload_raw: String = row.get(20)?;
            Ok(TaskWithPayload {
                id: row.get(0)?,
                repo_id: row.get(1)?,
                jira_account_id: row.get(2)?,
                jira_board_id: row.get(3)?,
                jira_issue_key: row.get(4)?,
                title: row.get(5)?,
                description: row.get(6)?,
                assignee: row.get(7)?,
                status: row.get(8)?,
                priority: row.get(9)?,
                source: row.get(10)?,
                require_plan: row.get::<_, i64>(11)? != 0,
                auto_start: row.get::<_, i64>(12)? != 0,
                auto_approve_plan: row.get::<_, i64>(13)? != 0,
                use_worktree: row.get::<_, i64>(14)? != 0,
                last_pipeline_error: row.get(15)?,
                last_pipeline_at: row.get(16)?,
                agent_profile_id: row.get(17)?,
                pr_url: row.get(18)?,
                pr_number: row.get(19)?,
                payload: serde_json::from_str(&payload_raw).unwrap_or(Value::Null),
                created_at: row.get(21)?,
                updated_at: row.get(22)?,
            })
        })?;
        rows.collect::<std::result::Result<Vec<_>, _>>()
            .map_err(anyhow::Error::from)
    }

    pub fn get_task_by_id(&self, task_id: &str) -> Result<Option<TaskWithPayload>> {
        let conn = self.connect()?;
        conn.query_row(
            "SELECT id, repo_id, jira_account_id, jira_board_id, jira_issue_key, title, description, assignee, status, priority, source, require_plan, auto_start, auto_approve_plan, use_worktree, last_pipeline_error, last_pipeline_at, agent_profile_id, pr_url, pr_number, payload_json, created_at, updated_at FROM tasks WHERE id = ?1",
            [task_id],
            |row| {
                let payload_raw: String = row.get(20)?;
                Ok(TaskWithPayload {
                    id: row.get(0)?,
                    repo_id: row.get(1)?,
                    jira_account_id: row.get(2)?,
                    jira_board_id: row.get(3)?,
                    jira_issue_key: row.get(4)?,
                    title: row.get(5)?,
                    description: row.get(6)?,
                    assignee: row.get(7)?,
                    status: row.get(8)?,
                    priority: row.get(9)?,
                    source: row.get(10)?,
                    require_plan: row.get::<_, i64>(11)? != 0,
                    auto_start: row.get::<_, i64>(12)? != 0,
                    auto_approve_plan: row.get::<_, i64>(13)? != 0,
                    use_worktree: row.get::<_, i64>(14)? != 0,
                    last_pipeline_error: row.get(15)?,
                    last_pipeline_at: row.get(16)?,
                    agent_profile_id: row.get(17)?,
                    pr_url: row.get(18)?,
                    pr_number: row.get(19)?,
                    payload: serde_json::from_str(&payload_raw).unwrap_or(Value::Null),
                    created_at: row.get(21)?,
                    updated_at: row.get(22)?,
                })
            },
        )
        .optional()
        .map_err(anyhow::Error::from)
    }

    pub fn delete_task(&self, task_id: &str) -> Result<()> {
        let conn = self.connect()?;
        let deleted = conn.execute("DELETE FROM tasks WHERE id = ?1", [task_id])?;
        if deleted == 0 {
            anyhow::bail!("Task not found: {}", task_id);
        }
        Ok(())
    }

    pub fn create_manual_task(&self, payload: &CreateTaskPayload) -> Result<TaskWithPayload> {
        let conn = self.connect()?;
        let id = Uuid::new_v4().to_string();
        let ts = now_iso();
        let status = payload.status.as_deref().unwrap_or("To Do");
        let require_plan = payload.require_plan.unwrap_or(true);
        let auto_start = payload.auto_start.unwrap_or(false);
        let auto_approve_plan = payload.auto_approve_plan.unwrap_or(false);
        let use_worktree = payload.use_worktree.unwrap_or(true);

        // Generate LOCAL-N key
        let max_local: Option<String> = conn
            .query_row(
                "SELECT jira_issue_key FROM tasks WHERE jira_issue_key LIKE 'LOCAL-%' ORDER BY CAST(SUBSTR(jira_issue_key, 7) AS INTEGER) DESC LIMIT 1",
                [],
                |row| row.get(0),
            )
            .optional()?;
        let next_num = max_local
            .and_then(|k| k.strip_prefix("LOCAL-").and_then(|n| n.parse::<i64>().ok()))
            .unwrap_or(0)
            + 1;
        let issue_key = format!("LOCAL-{}", next_num);

        conn.execute(
            r#"INSERT INTO tasks (
                 id, repo_id, jira_account_id, jira_board_id, jira_issue_key, title,
                 description, assignee, status, priority, source, require_plan, auto_start,
                 auto_approve_plan, use_worktree, agent_profile_id, last_pipeline_error, last_pipeline_at, payload_json, created_at, updated_at
               ) VALUES (?1, ?2, NULL, NULL, ?3, ?4, ?5, NULL, ?6, ?7, 'manual', ?8, ?9, ?10, ?11, ?12, NULL, NULL, '{}', ?13, ?14)"#,
            params![
                id,
                payload.repo_id,
                issue_key,
                payload.title,
                payload.description,
                status,
                payload.priority,
                require_plan,
                auto_start,
                auto_approve_plan,
                use_worktree,
                payload.agent_profile_id,
                ts,
                ts,
            ],
        )?;
        self.get_task_by_id(&id)?
            .context("task missing after insert")
    }

    pub fn update_task_status(&self, task_id: &str, status: &str) -> Result<()> {
        let conn = self.connect()?;
        conn.execute(
            "UPDATE tasks SET status = ?1, updated_at = ?2 WHERE id = ?3",
            params![status, now_iso(), task_id],
        )?;
        Ok(())
    }

    pub fn update_task_pipeline_state(
        &self,
        task_id: &str,
        last_pipeline_error: Option<&str>,
    ) -> Result<()> {
        let conn = self.connect()?;
        conn.execute(
            "UPDATE tasks SET last_pipeline_error = ?1, last_pipeline_at = ?2, updated_at = ?2 WHERE id = ?3",
            params![last_pipeline_error, now_iso(), task_id],
        )?;
        Ok(())
    }

    pub fn update_task_details(
        &self,
        task_id: &str,
        title: &str,
        description: Option<&str>,
        priority: Option<&str>,
        require_plan: bool,
        auto_start: bool,
        auto_approve_plan: bool,
        use_worktree: bool,
        agent_profile_id: Option<&str>,
    ) -> Result<()> {
        let conn = self.connect()?;
        conn.execute(
            "UPDATE tasks SET title = ?1, description = ?2, priority = ?3, require_plan = ?4, auto_start = ?5, auto_approve_plan = ?6, use_worktree = ?7, agent_profile_id = ?8, updated_at = ?9 WHERE id = ?10",
            params![
                title,
                description,
                priority,
                require_plan,
                auto_start,
                auto_approve_plan,
                use_worktree,
                agent_profile_id,
                now_iso(),
                task_id
            ],
        )?;
        Ok(())
    }

    pub fn update_task_pr(&self, task_id: &str, pr_url: &str, pr_number: Option<i64>) -> Result<()> {
        let conn = self.connect()?;
        conn.execute(
            "UPDATE tasks SET pr_url = ?1, pr_number = ?2, updated_at = ?3 WHERE id = ?4",
            params![pr_url, pr_number, now_iso(), task_id],
        )?;
        Ok(())
    }
}
