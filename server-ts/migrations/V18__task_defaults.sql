CREATE TABLE IF NOT EXISTS task_defaults (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  repo_id TEXT NOT NULL REFERENCES repos(id) ON DELETE CASCADE,
  provider_name TEXT,
  require_plan INTEGER NOT NULL DEFAULT 1,
  auto_start INTEGER NOT NULL DEFAULT 0,
  auto_approve_plan INTEGER NOT NULL DEFAULT 0,
  use_worktree INTEGER NOT NULL DEFAULT 1,
  carry_dirty_state INTEGER NOT NULL DEFAULT 0,
  priority TEXT,
  UNIQUE(repo_id, provider_name)
);
