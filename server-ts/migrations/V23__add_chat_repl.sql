-- Chat REPL: task-independent, CLI-like chat sessions scoped to a repo.

CREATE TABLE IF NOT EXISTS chat_sessions (
  id TEXT PRIMARY KEY,
  repo_id TEXT NOT NULL,
  profile_id TEXT NOT NULL,
  agent_session_id TEXT,
  title TEXT,
  first_message TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (repo_id) REFERENCES repos(id)
);

CREATE INDEX IF NOT EXISTS idx_chat_sessions_repo_id ON chat_sessions(repo_id);

CREATE TABLE IF NOT EXISTS chat_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL,
  type TEXT NOT NULL,
  data TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (session_id) REFERENCES chat_sessions(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_chat_logs_session_id ON chat_logs(session_id, id);

-- Relax task_memories so chat-originated memories can share the same table + FTS index.
-- SQLite cannot alter column constraints, so recreate the table.

CREATE TABLE task_memories_new (
  id TEXT PRIMARY KEY,
  repo_id TEXT NOT NULL,
  task_id TEXT,
  run_id TEXT,
  chat_session_id TEXT,
  title TEXT NOT NULL,
  summary TEXT NOT NULL,
  files_changed TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL,
  FOREIGN KEY (repo_id) REFERENCES repos(id),
  FOREIGN KEY (task_id) REFERENCES tasks(id),
  FOREIGN KEY (chat_session_id) REFERENCES chat_sessions(id) ON DELETE SET NULL
);

INSERT INTO task_memories_new (id, repo_id, task_id, run_id, title, summary, files_changed, created_at)
SELECT id, repo_id, task_id, run_id, title, summary, files_changed, created_at
FROM task_memories;

-- Drop triggers and FTS before rotating tables so they don't reference a stale schema.
DROP TRIGGER IF EXISTS task_memories_ai;
DROP TRIGGER IF EXISTS task_memories_ad;
DROP TRIGGER IF EXISTS task_memories_au;
DROP TABLE IF EXISTS task_memories_fts;
DROP TABLE task_memories;
ALTER TABLE task_memories_new RENAME TO task_memories;

CREATE VIRTUAL TABLE task_memories_fts USING fts5(
  title,
  summary,
  files_changed,
  content='task_memories',
  content_rowid='rowid'
);

INSERT INTO task_memories_fts(rowid, title, summary, files_changed)
SELECT rowid, title, summary, files_changed FROM task_memories;

CREATE TRIGGER task_memories_ai AFTER INSERT ON task_memories BEGIN
  INSERT INTO task_memories_fts(rowid, title, summary, files_changed)
  VALUES (new.rowid, new.title, new.summary, new.files_changed);
END;

CREATE TRIGGER task_memories_ad AFTER DELETE ON task_memories BEGIN
  INSERT INTO task_memories_fts(task_memories_fts, rowid, title, summary, files_changed)
  VALUES ('delete', old.rowid, old.title, old.summary, old.files_changed);
END;

CREATE TRIGGER task_memories_au AFTER UPDATE ON task_memories BEGIN
  INSERT INTO task_memories_fts(task_memories_fts, rowid, title, summary, files_changed)
  VALUES ('delete', old.rowid, old.title, old.summary, old.files_changed);
  INSERT INTO task_memories_fts(rowid, title, summary, files_changed)
  VALUES (new.rowid, new.title, new.summary, new.files_changed);
END;
