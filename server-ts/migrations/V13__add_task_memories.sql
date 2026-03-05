CREATE TABLE IF NOT EXISTS task_memories (
  id TEXT PRIMARY KEY,
  repo_id TEXT NOT NULL,
  task_id TEXT NOT NULL,
  run_id TEXT NOT NULL,
  title TEXT NOT NULL,
  summary TEXT NOT NULL,
  files_changed TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL,
  FOREIGN KEY (repo_id) REFERENCES repos(id),
  FOREIGN KEY (task_id) REFERENCES tasks(id)
);

CREATE VIRTUAL TABLE IF NOT EXISTS task_memories_fts USING fts5(
  title,
  summary,
  files_changed,
  content='task_memories',
  content_rowid='rowid'
);

CREATE TRIGGER IF NOT EXISTS task_memories_ai AFTER INSERT ON task_memories BEGIN
  INSERT INTO task_memories_fts(rowid, title, summary, files_changed)
  VALUES (new.rowid, new.title, new.summary, new.files_changed);
END;

CREATE TRIGGER IF NOT EXISTS task_memories_ad AFTER DELETE ON task_memories BEGIN
  INSERT INTO task_memories_fts(task_memories_fts, rowid, title, summary, files_changed)
  VALUES ('delete', old.rowid, old.title, old.summary, old.files_changed);
END;

CREATE TRIGGER IF NOT EXISTS task_memories_au AFTER UPDATE ON task_memories BEGIN
  INSERT INTO task_memories_fts(task_memories_fts, rowid, title, summary, files_changed)
  VALUES ('delete', old.rowid, old.title, old.summary, old.files_changed);
  INSERT INTO task_memories_fts(rowid, title, summary, files_changed)
  VALUES (new.rowid, new.title, new.summary, new.files_changed);
END;
