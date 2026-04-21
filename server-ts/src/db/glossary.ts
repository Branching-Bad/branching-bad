import { v4 as uuidv4 } from 'uuid';
import { Db, nowIso } from './index.js';

export interface GlossaryTerm {
  id: string;
  repo_id: string;
  term: string;
  description: string;
  created_at: string;
}

export interface GlossaryTermWithRank extends GlossaryTerm {
  rank: number;
}

declare module './index.js' {
  interface Db {
    insertGlossaryTerm(repoId: string, term: string, description: string): GlossaryTerm;
    updateGlossaryTerm(id: string, term: string, description: string): void;
    deleteGlossaryTerm(id: string): void;
    listGlossaryTerms(repoId: string): GlossaryTerm[];
    searchGlossaryTerms(repoId: string, query: string, limit?: number): GlossaryTerm[];
    searchGlossaryTermsWithRank(repoId: string, query: string, limit?: number): GlossaryTermWithRank[];
    findGlossaryTermByName(repoId: string, term: string): GlossaryTerm | null;
  }
}

function rowToTerm(row: any): GlossaryTerm {
  return {
    id: row.id,
    repo_id: row.repo_id,
    term: row.term,
    description: row.description,
    created_at: row.created_at,
  };
}

Db.prototype.insertGlossaryTerm = function (
  repoId: string,
  term: string,
  description: string,
): GlossaryTerm {
  const db = this.connect();
  const id = uuidv4();
  const ts = nowIso();
  db.prepare(
    'INSERT INTO glossary_terms (id, repo_id, term, description, created_at) VALUES (?, ?, ?, ?, ?)',
  ).run(id, repoId, term, description, ts);
  return { id, repo_id: repoId, term, description, created_at: ts };
};

Db.prototype.updateGlossaryTerm = function (
  id: string,
  term: string,
  description: string,
): void {
  const db = this.connect();
  db.prepare('UPDATE glossary_terms SET term = ?, description = ? WHERE id = ?').run(term, description, id);
};

Db.prototype.deleteGlossaryTerm = function (id: string): void {
  const db = this.connect();
  db.prepare('DELETE FROM glossary_terms WHERE id = ?').run(id);
};

Db.prototype.listGlossaryTerms = function (repoId: string): GlossaryTerm[] {
  const db = this.connect();
  const rows = db.prepare(
    'SELECT * FROM glossary_terms WHERE repo_id = ? ORDER BY term ASC',
  ).all(repoId) as any[];
  return rows.map(rowToTerm);
};

Db.prototype.findGlossaryTermByName = function (
  repoId: string,
  term: string,
): GlossaryTerm | null {
  const db = this.connect();
  const row = db.prepare(
    'SELECT * FROM glossary_terms WHERE repo_id = ? AND LOWER(term) = LOWER(?) LIMIT 1',
  ).get(repoId, term) as any;
  return row ? rowToTerm(row) : null;
};

Db.prototype.searchGlossaryTerms = function (
  repoId: string,
  query: string,
  limit = 5,
): GlossaryTerm[] {
  const db = this.connect();
  const rows = db.prepare(
    `SELECT g.* FROM glossary_terms g
     JOIN glossary_terms_fts fts ON g.rowid = fts.rowid
     WHERE glossary_terms_fts MATCH ? AND g.repo_id = ?
     ORDER BY bm25(glossary_terms_fts) LIMIT ?`,
  ).all(query, repoId, limit) as any[];
  return rows.map(rowToTerm);
};

Db.prototype.searchGlossaryTermsWithRank = function (
  repoId: string,
  query: string,
  limit = 10,
): GlossaryTermWithRank[] {
  const db = this.connect();
  const rows = db.prepare(
    `SELECT g.*, bm25(glossary_terms_fts) AS rank FROM glossary_terms g
     JOIN glossary_terms_fts fts ON g.rowid = fts.rowid
     WHERE glossary_terms_fts MATCH ? AND g.repo_id = ?
     ORDER BY rank LIMIT ?`,
  ).all(query, repoId, limit) as any[];
  return rows.map((r) => ({ ...rowToTerm(r), rank: typeof r.rank === 'number' ? r.rank : 0 }));
};
