use std::path::PathBuf;

use anyhow::{Context, Result};
use chrono::Utc;
use rusqlite::{Connection, OptionalExtension, params};
use serde_json::{Value, json};
use uuid::Uuid;

use crate::models::{
    AgentProfile, AgentProfileWithMetadata, AutostartJob, ClearPipelineResult, CreateTaskPayload,
    DiscoveredProfile, JiraAccount, JiraBoard, Plan, PlanJob, PlanWithParsed, Repo,
    RepoAgentPreference, RepoBinding, ReviewComment, Run, RunEvent, TaskWithPayload,
};

pub struct Db {
    pub path: PathBuf,
}

#[derive(Debug, Clone)]
pub struct UpsertTaskTransition {
    pub task_id: String,
    pub is_new: bool,
    pub previous_status: Option<String>,
    pub current_status: String,
}

#[derive(Debug, Clone)]
pub struct UpsertTasksResult {
    pub synced: usize,
    pub transitions: Vec<UpsertTaskTransition>,
}

impl Db {
    pub fn new(path: PathBuf) -> Self {
        Self { path }
    }

    pub fn connect(&self) -> Result<Connection> {
        let conn = Connection::open(&self.path)
            .with_context(|| format!("failed to open sqlite: {}", self.path.display()))?;
        conn.pragma_update(None, "foreign_keys", "ON")?;
        conn.pragma_update(None, "journal_mode", "WAL")?;
        Ok(conn)
    }

    pub fn init(&self) -> Result<()> {
        let conn = self.connect()?;
        conn.execute_batch(
            r#"
CREATE TABLE IF NOT EXISTS repos (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  path TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS jira_accounts (
  id TEXT PRIMARY KEY,
  base_url TEXT NOT NULL,
  email TEXT NOT NULL,
  api_token TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(base_url, email)
);

CREATE TABLE IF NOT EXISTS jira_boards (
  id TEXT PRIMARY KEY,
  jira_account_id TEXT NOT NULL,
  board_id TEXT NOT NULL,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(jira_account_id, board_id),
  FOREIGN KEY (jira_account_id) REFERENCES jira_accounts(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS repo_jira_bindings (
  repo_id TEXT PRIMARY KEY,
  jira_account_id TEXT NOT NULL,
  jira_board_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (repo_id) REFERENCES repos(id) ON DELETE CASCADE,
  FOREIGN KEY (jira_account_id) REFERENCES jira_accounts(id) ON DELETE CASCADE,
  FOREIGN KEY (jira_board_id) REFERENCES jira_boards(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  repo_id TEXT NOT NULL,
  jira_account_id TEXT,
  jira_board_id TEXT,
  jira_issue_key TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  assignee TEXT,
  status TEXT NOT NULL,
  priority TEXT,
  source TEXT NOT NULL DEFAULT 'jira',
  require_plan INTEGER NOT NULL DEFAULT 1,
  auto_start INTEGER NOT NULL DEFAULT 0,
  auto_approve_plan INTEGER NOT NULL DEFAULT 0,
  last_pipeline_error TEXT,
  last_pipeline_at TEXT,
  payload_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(jira_account_id, jira_issue_key),
  FOREIGN KEY (repo_id) REFERENCES repos(id) ON DELETE CASCADE,
  FOREIGN KEY (jira_account_id) REFERENCES jira_accounts(id) ON DELETE CASCADE,
  FOREIGN KEY (jira_board_id) REFERENCES jira_boards(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_tasks_repo_updated ON tasks(repo_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS plans (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL,
  version INTEGER NOT NULL,
  status TEXT NOT NULL,
  plan_markdown TEXT NOT NULL,
  plan_json TEXT NOT NULL,
  tasklist_json TEXT NOT NULL DEFAULT '{}',
  tasklist_schema_version INTEGER NOT NULL DEFAULT 1,
  generation_mode TEXT NOT NULL DEFAULT 'manual',
  validation_errors_json TEXT,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(task_id, version),
  FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_plans_task_version ON plans(task_id, version DESC);

CREATE TABLE IF NOT EXISTS plan_jobs (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL,
  mode TEXT NOT NULL,
  status TEXT NOT NULL,
  revision_comment TEXT,
  plan_id TEXT,
  error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  started_at TEXT,
  completed_at TEXT,
  FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE,
  FOREIGN KEY (plan_id) REFERENCES plans(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_plan_jobs_task_created ON plan_jobs(task_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_plan_jobs_status_created ON plan_jobs(status, created_at);

CREATE TABLE IF NOT EXISTS autostart_jobs (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL,
  trigger_kind TEXT NOT NULL,
  state TEXT NOT NULL,
  plan_id TEXT,
  run_id TEXT,
  error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  started_at TEXT,
  completed_at TEXT,
  FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_autostart_jobs_state_created ON autostart_jobs(state, created_at);
CREATE INDEX IF NOT EXISTS idx_autostart_jobs_task_state ON autostart_jobs(task_id, state);

CREATE TABLE IF NOT EXISTS plan_actions (
  id TEXT PRIMARY KEY,
  plan_id TEXT NOT NULL,
  action TEXT NOT NULL,
  comment TEXT,
  actor TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (plan_id) REFERENCES plans(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS runs (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL,
  plan_id TEXT NOT NULL,
  status TEXT NOT NULL,
  branch_name TEXT NOT NULL,
  agent_profile_id TEXT,
  started_at TEXT,
  completed_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE,
  FOREIGN KEY (plan_id) REFERENCES plans(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_runs_task_created ON runs(task_id, created_at DESC);

CREATE TABLE IF NOT EXISTS events (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  type TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (run_id) REFERENCES runs(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS agent_profiles (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  agent_name TEXT NOT NULL,
  model TEXT NOT NULL,
  command TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT '',
  discovery_kind TEXT NOT NULL,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(provider, agent_name, model, command, source)
);

CREATE INDEX IF NOT EXISTS idx_agent_profiles_provider ON agent_profiles(provider);

CREATE TABLE IF NOT EXISTS repo_agent_preferences (
  repo_id TEXT PRIMARY KEY,
  agent_profile_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (repo_id) REFERENCES repos(id) ON DELETE CASCADE,
  FOREIGN KEY (agent_profile_id) REFERENCES agent_profiles(id) ON DELETE CASCADE
);
"#,
        )?;

        self.ensure_column_exists(&conn, "runs", "agent_profile_id", "TEXT")?;
        self.ensure_column_exists(&conn, "runs", "pid", "INTEGER")?;
        self.ensure_column_exists(&conn, "runs", "exit_code", "INTEGER")?;
        self.ensure_column_exists(&conn, "tasks", "source", "TEXT NOT NULL DEFAULT 'jira'")?;
        self.ensure_column_exists(&conn, "tasks", "require_plan", "INTEGER NOT NULL DEFAULT 1")?;
        self.ensure_column_exists(
            &conn,
            "tasks",
            "auto_start",
            "INTEGER NOT NULL DEFAULT 0",
        )?;
        self.ensure_column_exists(
            &conn,
            "tasks",
            "auto_approve_plan",
            "INTEGER NOT NULL DEFAULT 0",
        )?;
        self.ensure_column_exists(&conn, "tasks", "last_pipeline_error", "TEXT")?;
        self.ensure_column_exists(&conn, "tasks", "last_pipeline_at", "TEXT")?;
        self.ensure_column_exists(&conn, "plans", "tasklist_json", "TEXT NOT NULL DEFAULT '{}'")?;
        self.ensure_column_exists(
            &conn,
            "plans",
            "tasklist_schema_version",
            "INTEGER NOT NULL DEFAULT 1",
        )?;
        self.ensure_column_exists(
            &conn,
            "plans",
            "generation_mode",
            "TEXT NOT NULL DEFAULT 'manual'",
        )?;
        self.ensure_column_exists(&conn, "plans", "validation_errors_json", "TEXT")?;
        self.ensure_column_exists(&conn, "plan_jobs", "agent_session_id", "TEXT")?;
        self.ensure_column_exists(&conn, "runs", "agent_session_id", "TEXT")?;
        self.ensure_column_exists(&conn, "runs", "review_comment_id", "TEXT")?;

        conn.execute_batch(
            r#"
CREATE TABLE IF NOT EXISTS review_comments (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL,
  run_id TEXT NOT NULL,
  comment TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  result_run_id TEXT,
  addressed_at TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE,
  FOREIGN KEY (run_id) REFERENCES runs(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_review_comments_task ON review_comments(task_id, created_at DESC);
"#,
        )?;

        self.migrate_tasks_nullable_jira(&conn)?;
        Ok(())
    }

    fn ensure_column_exists(
        &self,
        conn: &Connection,
        table: &str,
        column: &str,
        column_def: &str,
    ) -> Result<()> {
        let mut stmt = conn.prepare(&format!("PRAGMA table_info({table})"))?;
        let mut rows = stmt.query([])?;
        while let Some(row) = rows.next()? {
            let name: String = row.get(1)?;
            if name == column {
                return Ok(());
            }
        }
        conn.execute(
            &format!("ALTER TABLE {table} ADD COLUMN {column} {column_def}"),
            [],
        )?;
        Ok(())
    }

    /// Migrate tasks table so jira_account_id and jira_board_id are nullable.
    /// SQLite doesn't support ALTER COLUMN, so we recreate the table if needed.
    fn migrate_tasks_nullable_jira(&self, conn: &Connection) -> Result<()> {
        // Check if jira_account_id is currently NOT NULL
        let mut stmt = conn.prepare("PRAGMA table_info(tasks)")?;
        let mut rows = stmt.query([])?;
        let mut needs_migration = false;
        while let Some(row) = rows.next()? {
            let name: String = row.get(1)?;
            let notnull: i32 = row.get(3)?;
            if (name == "jira_account_id" || name == "jira_board_id") && notnull == 1 {
                needs_migration = true;
                break;
            }
        }
        drop(rows);
        drop(stmt);

        if !needs_migration {
            return Ok(());
        }

        conn.execute_batch(
            r#"
            CREATE TABLE tasks_new (
              id TEXT PRIMARY KEY,
              repo_id TEXT NOT NULL,
              jira_account_id TEXT,
              jira_board_id TEXT,
              jira_issue_key TEXT NOT NULL,
              title TEXT NOT NULL,
              description TEXT,
              assignee TEXT,
              status TEXT NOT NULL,
              priority TEXT,
              source TEXT NOT NULL DEFAULT 'jira',
              require_plan INTEGER NOT NULL DEFAULT 1,
              auto_start INTEGER NOT NULL DEFAULT 0,
              auto_approve_plan INTEGER NOT NULL DEFAULT 0,
              last_pipeline_error TEXT,
              last_pipeline_at TEXT,
              payload_json TEXT NOT NULL,
              created_at TEXT NOT NULL,
              updated_at TEXT NOT NULL,
              UNIQUE(jira_account_id, jira_issue_key),
              FOREIGN KEY (repo_id) REFERENCES repos(id) ON DELETE CASCADE,
              FOREIGN KEY (jira_account_id) REFERENCES jira_accounts(id) ON DELETE CASCADE,
              FOREIGN KEY (jira_board_id) REFERENCES jira_boards(id) ON DELETE CASCADE
            );

            INSERT INTO tasks_new (id, repo_id, jira_account_id, jira_board_id, jira_issue_key, title, description, assignee, status, priority, source, require_plan, auto_start, auto_approve_plan, last_pipeline_error, last_pipeline_at, payload_json, created_at, updated_at)
              SELECT id, repo_id, jira_account_id, jira_board_id, jira_issue_key, title, description, assignee, status, priority, source, require_plan, auto_start, auto_approve_plan, last_pipeline_error, last_pipeline_at, payload_json, created_at, updated_at FROM tasks;

            DROP TABLE tasks;

            ALTER TABLE tasks_new RENAME TO tasks;

            CREATE INDEX IF NOT EXISTS idx_tasks_repo_updated ON tasks(repo_id, updated_at DESC);
            "#,
        )?;

        Ok(())
    }

    pub fn db_path_string(&self) -> String {
        self.path.to_string_lossy().to_string()
    }

    pub fn create_or_update_repo(&self, path: &str, name: Option<&str>) -> Result<Repo> {
        let conn = self.connect()?;
        let existing: Option<Repo> = conn
            .query_row(
                "SELECT id, name, path, created_at, updated_at FROM repos WHERE path = ?1",
                [path],
                |row| {
                    Ok(Repo {
                        id: row.get(0)?,
                        name: row.get(1)?,
                        path: row.get(2)?,
                        created_at: row.get(3)?,
                        updated_at: row.get(4)?,
                    })
                },
            )
            .optional()?;
        let ts = now_iso();

        if let Some(repo) = existing {
            let updated_name = name.unwrap_or(repo.name.as_str()).to_string();
            conn.execute(
                "UPDATE repos SET name = ?1, updated_at = ?2 WHERE id = ?3",
                params![updated_name, ts, repo.id],
            )?;
            return self
                .get_repo_by_id(&repo.id)?
                .context("repo not found after update");
        }

        let repo = Repo {
            id: Uuid::new_v4().to_string(),
            name: name
                .map(ToString::to_string)
                .filter(|s| !s.trim().is_empty())
                .unwrap_or_else(|| {
                    std::path::Path::new(path)
                        .file_name()
                        .map(|s| s.to_string_lossy().to_string())
                        .unwrap_or_else(|| "repo".to_string())
                }),
            path: path.to_string(),
            created_at: ts.clone(),
            updated_at: ts,
        };
        conn.execute(
            "INSERT INTO repos (id, name, path, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5)",
            params![repo.id, repo.name, repo.path, repo.created_at, repo.updated_at],
        )?;
        Ok(repo)
    }

    pub fn list_repos(&self) -> Result<Vec<Repo>> {
        let conn = self.connect()?;
        let mut stmt =
            conn.prepare("SELECT id, name, path, created_at, updated_at FROM repos ORDER BY updated_at DESC")?;
        let rows = stmt.query_map([], |row| {
            Ok(Repo {
                id: row.get(0)?,
                name: row.get(1)?,
                path: row.get(2)?,
                created_at: row.get(3)?,
                updated_at: row.get(4)?,
            })
        })?;
        rows.collect::<std::result::Result<Vec<_>, _>>()
            .map_err(anyhow::Error::from)
    }

    pub fn get_repo_by_id(&self, id: &str) -> Result<Option<Repo>> {
        let conn = self.connect()?;
        conn.query_row(
            "SELECT id, name, path, created_at, updated_at FROM repos WHERE id = ?1",
            [id],
            |row| {
                Ok(Repo {
                    id: row.get(0)?,
                    name: row.get(1)?,
                    path: row.get(2)?,
                    created_at: row.get(3)?,
                    updated_at: row.get(4)?,
                })
            },
        )
        .optional()
        .map_err(anyhow::Error::from)
    }

    pub fn create_or_update_jira_account(
        &self,
        base_url: &str,
        email: &str,
        api_token: &str,
    ) -> Result<JiraAccount> {
        let conn = self.connect()?;
        let existing: Option<JiraAccount> = conn
            .query_row(
                "SELECT id, base_url, email, api_token, created_at, updated_at FROM jira_accounts WHERE base_url = ?1 AND email = ?2",
                params![base_url, email],
                |row| {
                    Ok(JiraAccount {
                        id: row.get(0)?,
                        base_url: row.get(1)?,
                        email: row.get(2)?,
                        api_token: row.get(3)?,
                        created_at: row.get(4)?,
                        updated_at: row.get(5)?,
                    })
                },
            )
            .optional()?;
        let ts = now_iso();

        if let Some(account) = existing {
            conn.execute(
                "UPDATE jira_accounts SET api_token = ?1, updated_at = ?2 WHERE id = ?3",
                params![api_token, ts, account.id],
            )?;
            return self
                .get_jira_account_by_id(&account.id)?
                .context("account not found after update");
        }

        let account = JiraAccount {
            id: Uuid::new_v4().to_string(),
            base_url: base_url.to_string(),
            email: email.to_string(),
            api_token: api_token.to_string(),
            created_at: ts.clone(),
            updated_at: ts,
        };
        conn.execute(
            "INSERT INTO jira_accounts (id, base_url, email, api_token, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![
                account.id,
                account.base_url,
                account.email,
                account.api_token,
                account.created_at,
                account.updated_at
            ],
        )?;
        Ok(account)
    }

    pub fn list_jira_accounts(&self) -> Result<Vec<JiraAccount>> {
        let conn = self.connect()?;
        let mut stmt = conn.prepare(
            "SELECT id, base_url, email, api_token, created_at, updated_at FROM jira_accounts ORDER BY updated_at DESC",
        )?;
        let rows = stmt.query_map([], |row| {
            Ok(JiraAccount {
                id: row.get(0)?,
                base_url: row.get(1)?,
                email: row.get(2)?,
                api_token: row.get(3)?,
                created_at: row.get(4)?,
                updated_at: row.get(5)?,
            })
        })?;
        rows.collect::<std::result::Result<Vec<_>, _>>()
            .map_err(anyhow::Error::from)
    }

    pub fn get_jira_account_by_id(&self, account_id: &str) -> Result<Option<JiraAccount>> {
        let conn = self.connect()?;
        conn.query_row(
            "SELECT id, base_url, email, api_token, created_at, updated_at FROM jira_accounts WHERE id = ?1",
            [account_id],
            |row| {
                Ok(JiraAccount {
                    id: row.get(0)?,
                    base_url: row.get(1)?,
                    email: row.get(2)?,
                    api_token: row.get(3)?,
                    created_at: row.get(4)?,
                    updated_at: row.get(5)?,
                })
            },
        )
        .optional()
        .map_err(anyhow::Error::from)
    }

    pub fn upsert_jira_boards(
        &self,
        account_id: &str,
        boards: &[(String, String)],
    ) -> Result<()> {
        let mut conn = self.connect()?;
        let tx = conn.transaction()?;
        let ts = now_iso();

        for (board_id, name) in boards {
            let existing_id: Option<String> = tx
                .query_row(
                    "SELECT id FROM jira_boards WHERE jira_account_id = ?1 AND board_id = ?2",
                    params![account_id, board_id],
                    |row| row.get(0),
                )
                .optional()?;
            let id = existing_id.unwrap_or_else(|| Uuid::new_v4().to_string());
            tx.execute(
                r#"INSERT INTO jira_boards (id, jira_account_id, board_id, name, created_at, updated_at)
                   VALUES (?1, ?2, ?3, ?4, ?5, ?6)
                   ON CONFLICT(jira_account_id, board_id)
                   DO UPDATE SET name = excluded.name, updated_at = excluded.updated_at"#,
                params![id, account_id, board_id, name, ts, ts],
            )?;
        }
        tx.commit()?;
        Ok(())
    }

    pub fn list_boards_by_account(&self, account_id: &str) -> Result<Vec<JiraBoard>> {
        let conn = self.connect()?;
        let mut stmt = conn.prepare(
            "SELECT id, jira_account_id, board_id, name, created_at, updated_at FROM jira_boards WHERE jira_account_id = ?1 ORDER BY name ASC",
        )?;
        let rows = stmt.query_map([account_id], |row| {
            Ok(JiraBoard {
                id: row.get(0)?,
                jira_account_id: row.get(1)?,
                board_id: row.get(2)?,
                name: row.get(3)?,
                created_at: row.get(4)?,
                updated_at: row.get(5)?,
            })
        })?;
        rows.collect::<std::result::Result<Vec<_>, _>>()
            .map_err(anyhow::Error::from)
    }

    pub fn get_board_by_id(&self, board_id: &str) -> Result<Option<JiraBoard>> {
        let conn = self.connect()?;
        conn.query_row(
            "SELECT id, jira_account_id, board_id, name, created_at, updated_at FROM jira_boards WHERE id = ?1",
            [board_id],
            |row| {
                Ok(JiraBoard {
                    id: row.get(0)?,
                    jira_account_id: row.get(1)?,
                    board_id: row.get(2)?,
                    name: row.get(3)?,
                    created_at: row.get(4)?,
                    updated_at: row.get(5)?,
                })
            },
        )
        .optional()
        .map_err(anyhow::Error::from)
    }

    pub fn upsert_repo_binding(
        &self,
        repo_id: &str,
        account_id: &str,
        board_id: &str,
    ) -> Result<RepoBinding> {
        let conn = self.connect()?;
        let ts = now_iso();
        conn.execute(
            r#"INSERT INTO repo_jira_bindings (repo_id, jira_account_id, jira_board_id, created_at, updated_at)
               VALUES (?1, ?2, ?3, ?4, ?5)
               ON CONFLICT(repo_id)
               DO UPDATE SET jira_account_id = excluded.jira_account_id,
                             jira_board_id = excluded.jira_board_id,
                             updated_at = excluded.updated_at"#,
            params![repo_id, account_id, board_id, ts, ts],
        )?;
        self.get_repo_binding(repo_id)?
            .context("binding missing after upsert")
    }

    pub fn get_repo_binding(&self, repo_id: &str) -> Result<Option<RepoBinding>> {
        let conn = self.connect()?;
        conn.query_row(
            "SELECT repo_id, jira_account_id, jira_board_id, created_at, updated_at FROM repo_jira_bindings WHERE repo_id = ?1",
            [repo_id],
            |row| {
                Ok(RepoBinding {
                    repo_id: row.get(0)?,
                    jira_account_id: row.get(1)?,
                    jira_board_id: row.get(2)?,
                    created_at: row.get(3)?,
                    updated_at: row.get(4)?,
                })
            },
        )
        .optional()
        .map_err(anyhow::Error::from)
    }

    pub fn upsert_tasks(
        &self,
        repo_id: &str,
        jira_account_id: &str,
        jira_board_id: &str,
        tasks: &[crate::models::JiraIssueForTask],
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
                     status = excluded.status,
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
                current_status: task.status.clone(),
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
            "SELECT id, repo_id, jira_account_id, jira_board_id, jira_issue_key, title, description, assignee, status, priority, source, require_plan, auto_start, auto_approve_plan, last_pipeline_error, last_pipeline_at, payload_json, created_at, updated_at FROM tasks WHERE repo_id = ?1 ORDER BY updated_at DESC",
        )?;
        let rows = stmt.query_map([repo_id], |row| {
            let payload_raw: String = row.get(16)?;
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
                last_pipeline_error: row.get(14)?,
                last_pipeline_at: row.get(15)?,
                payload: serde_json::from_str(&payload_raw).unwrap_or(Value::Null),
                created_at: row.get(17)?,
                updated_at: row.get(18)?,
            })
        })?;
        rows.collect::<std::result::Result<Vec<_>, _>>()
            .map_err(anyhow::Error::from)
    }

    pub fn get_task_by_id(&self, task_id: &str) -> Result<Option<TaskWithPayload>> {
        let conn = self.connect()?;
        conn.query_row(
            "SELECT id, repo_id, jira_account_id, jira_board_id, jira_issue_key, title, description, assignee, status, priority, source, require_plan, auto_start, auto_approve_plan, last_pipeline_error, last_pipeline_at, payload_json, created_at, updated_at FROM tasks WHERE id = ?1",
            [task_id],
            |row| {
                let payload_raw: String = row.get(16)?;
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
                    last_pipeline_error: row.get(14)?,
                    last_pipeline_at: row.get(15)?,
                    payload: serde_json::from_str(&payload_raw).unwrap_or(Value::Null),
                    created_at: row.get(17)?,
                    updated_at: row.get(18)?,
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
                 auto_approve_plan, last_pipeline_error, last_pipeline_at, payload_json, created_at, updated_at
               ) VALUES (?1, ?2, NULL, NULL, ?3, ?4, ?5, NULL, ?6, ?7, 'manual', ?8, ?9, ?10, NULL, NULL, '{}', ?11, ?12)"#,
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

    pub fn update_task_details(
        &self,
        task_id: &str,
        title: &str,
        description: Option<&str>,
        priority: Option<&str>,
        require_plan: bool,
        auto_start: bool,
        auto_approve_plan: bool,
    ) -> Result<()> {
        let conn = self.connect()?;
        conn.execute(
            "UPDATE tasks SET title = ?1, description = ?2, priority = ?3, require_plan = ?4, auto_start = ?5, auto_approve_plan = ?6, updated_at = ?7 WHERE id = ?8",
            params![
                title,
                description,
                priority,
                require_plan,
                auto_start,
                auto_approve_plan,
                now_iso(),
                task_id
            ],
        )?;
        Ok(())
    }

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

    pub fn create_run(
        &self,
        task_id: &str,
        plan_id: &str,
        status: &str,
        branch_name: &str,
        agent_profile_id: Option<&str>,
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
            "INSERT INTO runs (id, task_id, plan_id, status, branch_name, agent_profile_id, pid, exit_code, started_at, completed_at, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, NULL, NULL, ?7, NULL, ?8, ?9)",
            params![id, task_id, plan_id, status, branch_name, agent_profile_id, started_at, ts, ts],
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
            "SELECT id, task_id, plan_id, status, branch_name, agent_profile_id, pid, exit_code, agent_session_id, review_comment_id, started_at, completed_at, created_at, updated_at FROM runs WHERE id = ?1",
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
                    started_at: row.get(10)?,
                    completed_at: row.get(11)?,
                    created_at: row.get(12)?,
                    updated_at: row.get(13)?,
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

    pub fn upsert_agent_profiles(&self, profiles: &[DiscoveredProfile]) -> Result<usize> {
        if profiles.is_empty() {
            return Ok(0);
        }
        let mut conn = self.connect()?;
        let tx = conn.transaction()?;
        let ts = now_iso();

        for profile in profiles {
            let existing_id: Option<String> = tx
                .query_row(
                    "SELECT id FROM agent_profiles WHERE provider = ?1 AND agent_name = ?2 AND model = ?3 AND command = ?4 AND source = ?5",
                    params![profile.provider, profile.agent_name, profile.model, profile.command, profile.source],
                    |row| row.get(0),
                )
                .optional()?;
            let id = existing_id.unwrap_or_else(|| Uuid::new_v4().to_string());
            tx.execute(
                r#"INSERT INTO agent_profiles (
                     id, provider, agent_name, model, command, source, discovery_kind, metadata_json, created_at, updated_at
                   ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)
                   ON CONFLICT(provider, agent_name, model, command, source)
                   DO UPDATE SET discovery_kind = excluded.discovery_kind,
                                 metadata_json = excluded.metadata_json,
                                 updated_at = excluded.updated_at"#,
                params![
                    id,
                    profile.provider,
                    profile.agent_name,
                    profile.model,
                    profile.command,
                    profile.source,
                    profile.discovery_kind,
                    profile.metadata.to_string(),
                    ts,
                    ts
                ],
            )?;
        }
        tx.commit()?;
        Ok(profiles.len())
    }

    pub fn list_agent_profiles(&self) -> Result<Vec<AgentProfileWithMetadata>> {
        let conn = self.connect()?;
        let mut stmt = conn.prepare(
            "SELECT id, provider, agent_name, model, command, source, discovery_kind, metadata_json, created_at, updated_at FROM agent_profiles ORDER BY provider ASC, agent_name ASC, model ASC, updated_at DESC",
        )?;
        let rows = stmt.query_map([], |row| {
            let metadata_raw: String = row.get(7)?;
            Ok(AgentProfileWithMetadata {
                id: row.get(0)?,
                provider: row.get(1)?,
                agent_name: row.get(2)?,
                model: row.get(3)?,
                command: row.get(4)?,
                source: row.get(5)?,
                discovery_kind: row.get(6)?,
                metadata: serde_json::from_str(&metadata_raw).unwrap_or_else(|_| json!({})),
                created_at: row.get(8)?,
                updated_at: row.get(9)?,
            })
        })?;
        rows.collect::<std::result::Result<Vec<_>, _>>()
            .map_err(anyhow::Error::from)
    }

    pub fn get_agent_profile_by_id(&self, profile_id: &str) -> Result<Option<AgentProfile>> {
        let conn = self.connect()?;
        conn.query_row(
            "SELECT id, provider, agent_name, model, command, source, discovery_kind, metadata_json, created_at, updated_at FROM agent_profiles WHERE id = ?1",
            [profile_id],
            |row| {
                Ok(AgentProfile {
                    id: row.get(0)?,
                    provider: row.get(1)?,
                    agent_name: row.get(2)?,
                    model: row.get(3)?,
                    command: row.get(4)?,
                    source: row.get(5)?,
                    discovery_kind: row.get(6)?,
                    metadata_json: row.get(7)?,
                    created_at: row.get(8)?,
                    updated_at: row.get(9)?,
                })
            },
        )
        .optional()
        .map_err(anyhow::Error::from)
    }

    pub fn set_repo_agent_preference(
        &self,
        repo_id: &str,
        agent_profile_id: &str,
    ) -> Result<RepoAgentPreference> {
        let conn = self.connect()?;
        let ts = now_iso();
        conn.execute(
            r#"INSERT INTO repo_agent_preferences (repo_id, agent_profile_id, created_at, updated_at)
               VALUES (?1, ?2, ?3, ?4)
               ON CONFLICT(repo_id)
               DO UPDATE SET agent_profile_id = excluded.agent_profile_id, updated_at = excluded.updated_at"#,
            params![repo_id, agent_profile_id, ts, ts],
        )?;
        self.get_repo_agent_preference(repo_id)?
            .context("repo preference missing after upsert")
    }

    pub fn get_repo_agent_preference(&self, repo_id: &str) -> Result<Option<RepoAgentPreference>> {
        let conn = self.connect()?;
        conn.query_row(
            "SELECT repo_id, agent_profile_id, created_at, updated_at FROM repo_agent_preferences WHERE repo_id = ?1",
            [repo_id],
            |row| {
                Ok(RepoAgentPreference {
                    repo_id: row.get(0)?,
                    agent_profile_id: row.get(1)?,
                    created_at: row.get(2)?,
                    updated_at: row.get(3)?,
                })
            },
        )
        .optional()
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

    pub fn fail_stale_running_runs(&self) -> Result<usize> {
        let conn = self.connect()?;
        let ts = now_iso();
        let count = conn.execute(
            "UPDATE runs SET status = 'failed', completed_at = ?1, updated_at = ?1 WHERE status = 'running'",
            params![ts],
        )?;
        // Also update tasks that were IN_PROGRESS for those runs
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

    /// Reset tasks stuck at PLAN_GENERATING (with no active plan job) back to TODO
    /// so the autostart worker can pick them up again.
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

    /// Force-clear all stuck pipeline state for a task: fail running plan jobs,
    /// fail/cancel pending+running autostart jobs, and reset the task status.
    /// Returns a summary of what was cleaned up.
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

        // Reset task from any intermediate pipeline status back to TODO
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

    /// Force-clear ALL stuck pipeline state across all tasks.
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

    pub fn get_latest_run_by_task(&self, task_id: &str) -> Result<Option<Run>> {
        let conn = self.connect()?;
        conn.query_row(
            "SELECT id, task_id, plan_id, status, branch_name, agent_profile_id, pid, exit_code, agent_session_id, review_comment_id, started_at, completed_at, created_at, updated_at FROM runs WHERE task_id = ?1 ORDER BY created_at DESC LIMIT 1",
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
                    started_at: row.get(10)?,
                    completed_at: row.get(11)?,
                    created_at: row.get(12)?,
                    updated_at: row.get(13)?,
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

    pub fn update_run_review_comment_id(&self, run_id: &str, review_comment_id: &str) -> Result<()> {
        let conn = self.connect()?;
        conn.execute(
            "UPDATE runs SET review_comment_id = ?1, updated_at = ?2 WHERE id = ?3",
            params![review_comment_id, now_iso(), run_id],
        )?;
        Ok(())
    }

    pub fn add_review_comment(
        &self,
        task_id: &str,
        run_id: &str,
        comment: &str,
    ) -> Result<ReviewComment> {
        let conn = self.connect()?;
        let id = Uuid::new_v4().to_string();
        let ts = now_iso();
        conn.execute(
            "INSERT INTO review_comments (id, task_id, run_id, comment, status, created_at) VALUES (?1, ?2, ?3, ?4, 'pending', ?5)",
            params![id, task_id, run_id, comment, ts],
        )?;
        Ok(ReviewComment {
            id,
            task_id: task_id.to_string(),
            run_id: run_id.to_string(),
            comment: comment.to_string(),
            status: "pending".to_string(),
            result_run_id: None,
            addressed_at: None,
            created_at: ts,
        })
    }

    pub fn list_review_comments(&self, task_id: &str) -> Result<Vec<ReviewComment>> {
        let conn = self.connect()?;
        let mut stmt = conn.prepare(
            "SELECT id, task_id, run_id, comment, status, result_run_id, addressed_at, created_at FROM review_comments WHERE task_id = ?1 ORDER BY created_at ASC",
        )?;
        let rows = stmt.query_map([task_id], |row| {
            Ok(ReviewComment {
                id: row.get(0)?,
                task_id: row.get(1)?,
                run_id: row.get(2)?,
                comment: row.get(3)?,
                status: row.get(4)?,
                result_run_id: row.get(5)?,
                addressed_at: row.get(6)?,
                created_at: row.get(7)?,
            })
        })?;
        rows.collect::<std::result::Result<Vec<_>, _>>()
            .map_err(anyhow::Error::from)
    }

    pub fn update_review_comment_status(
        &self,
        id: &str,
        status: &str,
        result_run_id: Option<&str>,
    ) -> Result<()> {
        let conn = self.connect()?;
        let addressed_at: Option<String> = if status == "addressed" {
            Some(now_iso())
        } else {
            None
        };
        conn.execute(
            "UPDATE review_comments SET status = ?1, result_run_id = ?2, addressed_at = ?3 WHERE id = ?4",
            params![status, result_run_id, addressed_at, id],
        )?;
        Ok(())
    }
}

fn now_iso() -> String {
    Utc::now().to_rfc3339()
}
