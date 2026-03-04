CREATE TABLE IF NOT EXISTS repository_rules (
  id TEXT PRIMARY KEY,
  repo_id TEXT,
  content TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'manual',
  source_comment_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (repo_id) REFERENCES repos(id)
);
