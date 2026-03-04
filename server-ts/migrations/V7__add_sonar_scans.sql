CREATE TABLE IF NOT EXISTS sonar_scans (
    id TEXT PRIMARY KEY,
    repo_id TEXT NOT NULL,
    account_id TEXT NOT NULL,
    project_key TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'running',
    issues_found INTEGER,
    error TEXT,
    created_at TEXT NOT NULL,
    completed_at TEXT
);
CREATE INDEX idx_sonar_scans_repo ON sonar_scans(repo_id);
