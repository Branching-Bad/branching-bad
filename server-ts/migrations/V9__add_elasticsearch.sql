CREATE TABLE IF NOT EXISTS es_investigations (
  id TEXT PRIMARY KEY,
  repo_id TEXT NOT NULL REFERENCES repos(id),
  provider_account_id TEXT NOT NULL,
  index_pattern TEXT NOT NULL,
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

CREATE TABLE IF NOT EXISTS es_saved_queries (
  id TEXT PRIMARY KEY,
  repo_id TEXT NOT NULL REFERENCES repos(id),
  index_pattern TEXT NOT NULL,
  label TEXT NOT NULL,
  question TEXT NOT NULL,
  query_template TEXT NOT NULL,
  keywords TEXT NOT NULL,
  use_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_es_saved_repo ON es_saved_queries(repo_id);
