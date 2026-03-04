-- V1: Complete initial schema
-- All tables use CREATE TABLE IF NOT EXISTS so this migration is idempotent
-- for both fresh databases and existing databases that already have these tables.

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
  use_worktree INTEGER NOT NULL DEFAULT 1,
  agent_profile_id TEXT,
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
  agent_session_id TEXT,
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
  pid INTEGER,
  exit_code INTEGER,
  agent_session_id TEXT,
  review_comment_id TEXT,
  chat_message_id TEXT,
  worktree_path TEXT,
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

CREATE TABLE IF NOT EXISTS review_comments (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL,
  run_id TEXT NOT NULL,
  comment TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  result_run_id TEXT,
  addressed_at TEXT,
  created_at TEXT NOT NULL,
  file_path TEXT,
  line_start INTEGER,
  line_end INTEGER,
  diff_hunk TEXT,
  review_mode TEXT NOT NULL DEFAULT 'instant',
  batch_id TEXT,
  FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE,
  FOREIGN KEY (run_id) REFERENCES runs(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_review_comments_task ON review_comments(task_id, created_at DESC);

CREATE TABLE IF NOT EXISTS run_diffs (
  run_id TEXT PRIMARY KEY,
  diff_text TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (run_id) REFERENCES runs(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS chat_messages (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  result_run_id TEXT,
  status TEXT NOT NULL DEFAULT 'sent',
  created_at TEXT NOT NULL,
  FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_chat_messages_task ON chat_messages(task_id, created_at ASC);

-- Generic provider tables
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

-- CloudWatch investigation tables
CREATE TABLE IF NOT EXISTS cw_investigations (
  id TEXT PRIMARY KEY,
  repo_id TEXT NOT NULL REFERENCES repos(id),
  provider_account_id TEXT NOT NULL,
  log_group TEXT NOT NULL,
  question TEXT NOT NULL,
  time_range_minutes INTEGER NOT NULL,
  query_phase1 TEXT,
  query_phase2 TEXT,
  result_json TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'running',
  linked_task_id TEXT,
  error_message TEXT,
  created_at TEXT NOT NULL,
  completed_at TEXT
);

CREATE TABLE IF NOT EXISTS cw_saved_queries (
  id TEXT PRIMARY KEY,
  repo_id TEXT NOT NULL REFERENCES repos(id),
  log_group TEXT NOT NULL,
  label TEXT NOT NULL,
  question TEXT NOT NULL,
  query_template TEXT NOT NULL,
  keywords TEXT NOT NULL,
  use_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_cw_saved_repo ON cw_saved_queries(repo_id);
