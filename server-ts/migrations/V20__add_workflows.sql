CREATE TABLE workflows (
  id           TEXT PRIMARY KEY,
  repo_id      TEXT NOT NULL REFERENCES repos(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  graph_json   TEXT NOT NULL,
  cron         TEXT,
  cron_enabled INTEGER NOT NULL DEFAULT 0,
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL
);

CREATE INDEX idx_workflows_repo ON workflows(repo_id);

CREATE TABLE workflow_runs (
  id            TEXT PRIMARY KEY,
  workflow_id   TEXT NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
  trigger       TEXT NOT NULL CHECK (trigger IN ('manual','cron')),
  status        TEXT NOT NULL CHECK (status IN ('running','done','failed','halted','cancelled')),
  started_at    TEXT NOT NULL,
  ended_at      TEXT,
  snapshot_json TEXT NOT NULL
);

CREATE INDEX idx_workflow_runs_wf ON workflow_runs(workflow_id, started_at DESC);

CREATE TABLE workflow_node_attempts (
  id            TEXT PRIMARY KEY,
  run_id        TEXT NOT NULL REFERENCES workflow_runs(id) ON DELETE CASCADE,
  node_id       TEXT NOT NULL,
  attempt_num   INTEGER NOT NULL,
  status        TEXT NOT NULL CHECK (status IN ('pending','running','done','failed','skipped','cancelled')),
  started_at    TEXT,
  ended_at      TEXT,
  exit_code     INTEGER,
  duration_ms   INTEGER,
  stdout_inline TEXT,
  stderr_inline TEXT,
  stdout_file   TEXT,
  stderr_file   TEXT,
  UNIQUE (run_id, node_id, attempt_num)
);

CREATE INDEX idx_wna_run ON workflow_node_attempts(run_id);
CREATE INDEX idx_wna_run_node ON workflow_node_attempts(run_id, node_id);
