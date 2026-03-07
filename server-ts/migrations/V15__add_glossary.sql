CREATE TABLE IF NOT EXISTS glossary_terms (
  id TEXT PRIMARY KEY,
  repo_id TEXT NOT NULL,
  term TEXT NOT NULL,
  description TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (repo_id) REFERENCES repos(id)
);

CREATE VIRTUAL TABLE IF NOT EXISTS glossary_terms_fts USING fts5(
  term,
  description,
  content='glossary_terms',
  content_rowid='rowid'
);

CREATE TRIGGER IF NOT EXISTS glossary_terms_ai AFTER INSERT ON glossary_terms BEGIN
  INSERT INTO glossary_terms_fts(rowid, term, description)
  VALUES (new.rowid, new.term, new.description);
END;

CREATE TRIGGER IF NOT EXISTS glossary_terms_ad AFTER DELETE ON glossary_terms BEGIN
  INSERT INTO glossary_terms_fts(glossary_terms_fts, rowid, term, description)
  VALUES ('delete', old.rowid, old.term, old.description);
END;

CREATE TRIGGER IF NOT EXISTS glossary_terms_au AFTER UPDATE ON glossary_terms BEGIN
  INSERT INTO glossary_terms_fts(glossary_terms_fts, rowid, term, description)
  VALUES ('delete', old.rowid, old.term, old.description);
  INSERT INTO glossary_terms_fts(rowid, term, description)
  VALUES (new.rowid, new.term, new.description);
END;
