mod agents;
mod autostart;
mod maintenance;
mod plan_jobs;
mod plans;
mod providers;
mod repos;
mod reviews;
mod runs;
mod tasks;

use std::path::PathBuf;

use anyhow::{Context, Result};
use chrono::Utc;
use rusqlite::Connection;

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
  FOREIGN KEY (repo_id) REFERENCES repos(id) ON DELETE CASCADE
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
        self.ensure_column_exists(&conn, "tasks", "use_worktree", "INTEGER NOT NULL DEFAULT 1")?;
        self.ensure_column_exists(&conn, "runs", "worktree_path", "TEXT")?;

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

        // ── Generic provider tables ──
        conn.execute_batch(
            r#"
CREATE TABLE IF NOT EXISTS provider_accounts (
    id TEXT PRIMARY KEY,
    provider_id TEXT NOT NULL,
    config_json TEXT NOT NULL,
    display_name TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS provider_resources (
    id TEXT PRIMARY KEY,
    provider_account_id TEXT NOT NULL REFERENCES provider_accounts(id) ON DELETE CASCADE,
    provider_id TEXT NOT NULL,
    external_id TEXT NOT NULL,
    name TEXT NOT NULL,
    extra_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE(provider_account_id, external_id)
);

CREATE TABLE IF NOT EXISTS provider_bindings (
    repo_id TEXT NOT NULL REFERENCES repos(id) ON DELETE CASCADE,
    provider_account_id TEXT NOT NULL REFERENCES provider_accounts(id) ON DELETE CASCADE,
    provider_resource_id TEXT NOT NULL REFERENCES provider_resources(id) ON DELETE CASCADE,
    provider_id TEXT NOT NULL,
    config_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY(repo_id, provider_account_id, provider_resource_id)
);

CREATE TABLE IF NOT EXISTS provider_items (
    id TEXT PRIMARY KEY,
    provider_account_id TEXT NOT NULL,
    provider_resource_id TEXT NOT NULL,
    provider_id TEXT NOT NULL,
    external_id TEXT NOT NULL,
    title TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    linked_task_id TEXT,
    data_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE(provider_account_id, external_id)
);

CREATE INDEX IF NOT EXISTS idx_provider_items_resource ON provider_items(provider_resource_id, status);
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
    fn migrate_tasks_nullable_jira(&self, conn: &Connection) -> Result<()> {
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
              FOREIGN KEY (repo_id) REFERENCES repos(id) ON DELETE CASCADE
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
}

fn now_iso() -> String {
    Utc::now().to_rfc3339()
}
