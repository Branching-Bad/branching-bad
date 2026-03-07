CREATE TABLE IF NOT EXISTS analyst_sessions (
  id TEXT PRIMARY KEY,
  repo_id TEXT NOT NULL,
  profile_id TEXT NOT NULL,
  agent_session_id TEXT,
  title TEXT,
  first_message TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS analyst_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL REFERENCES analyst_sessions(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  data TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_analyst_logs_session ON analyst_logs(session_id);
CREATE INDEX IF NOT EXISTS idx_analyst_sessions_repo ON analyst_sessions(repo_id);
