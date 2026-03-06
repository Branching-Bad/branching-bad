import { v4 as uuidv4 } from 'uuid';
import type { RepositoryRule } from '../models.js';
import { Db, nowIso } from './index.js';

declare module './index.js' {
  interface Db {
    listRulesForPrompt(repoId: string): RepositoryRule[];
    listRules(repoId?: string): RepositoryRule[];
    createRule(
      repoId: string | undefined,
      content: string,
      source: string,
      sourceCommentId?: string,
    ): RepositoryRule;
    updateRule(id: string, content: string): void;
    deleteRule(id: string): void;
    getRuleById(id: string): RepositoryRule | null;
    bulkReplaceRules(repoId: string | undefined, contents: string[]): RepositoryRule[];
  }
}

const RULE_COLS =
  'id, repo_id, content, source, source_comment_id, created_at, updated_at';

function rowToRule(row: any): RepositoryRule {
  return {
    id: row.id,
    repo_id: row.repo_id,
    content: row.content,
    source: row.source,
    source_comment_id: row.source_comment_id,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

Db.prototype.listRulesForPrompt = function (repoId: string): RepositoryRule[] {
  const db = this.connect();
    const rows = db
      .prepare(
        `SELECT ${RULE_COLS} FROM repository_rules
         WHERE repo_id = ? OR repo_id IS NULL
         ORDER BY created_at ASC`,
      )
      .all(repoId) as any[];
    return rows.map(rowToRule);
};

Db.prototype.listRules = function (repoId?: string): RepositoryRule[] {
  if (repoId) {
    return this.listRulesForPrompt(repoId);
  }

  const db = this.connect();
    const rows = db
      .prepare(
        `SELECT ${RULE_COLS} FROM repository_rules
         WHERE repo_id IS NULL
         ORDER BY created_at ASC`,
      )
      .all() as any[];
    return rows.map(rowToRule);
};

Db.prototype.createRule = function (
  repoId: string | undefined,
  content: string,
  source: string,
  sourceCommentId?: string,
): RepositoryRule {
  const db = this.connect();
    const id = uuidv4();
    const ts = nowIso();
    db.prepare(
      `INSERT INTO repository_rules (id, repo_id, content, source, source_comment_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(id, repoId ?? null, content, source, sourceCommentId ?? null, ts, ts);

    return {
      id,
      repo_id: repoId ?? null,
      content,
      source,
      source_comment_id: sourceCommentId ?? null,
      created_at: ts,
      updated_at: ts,
    };
};

Db.prototype.updateRule = function (id: string, content: string): void {
  const db = this.connect();
    const result = db
      .prepare('UPDATE repository_rules SET content = ?, updated_at = ? WHERE id = ?')
      .run(content, nowIso(), id);
    if (Number(result.changes) === 0) {
      throw new Error('Rule not found');
    }
};

Db.prototype.deleteRule = function (id: string): void {
  const db = this.connect();
    db.prepare('DELETE FROM repository_rules WHERE id = ?').run(id);
};

Db.prototype.getRuleById = function (id: string): RepositoryRule | null {
  const db = this.connect();
    const row = db
      .prepare(`SELECT ${RULE_COLS} FROM repository_rules WHERE id = ?`)
      .get(id) as any | undefined;
    return row ? rowToRule(row) : null;
};

Db.prototype.bulkReplaceRules = function (
  repoId: string | undefined,
  contents: string[],
): RepositoryRule[] {
  const db = this.connect();
    const ts = nowIso();
    const result: RepositoryRule[] = [];

    const tx = this.transaction(() => {
      if (repoId) {
        db.prepare('DELETE FROM repository_rules WHERE repo_id = ?').run(repoId);
      } else {
        db.prepare('DELETE FROM repository_rules WHERE repo_id IS NULL').run();
      }

      for (const content of contents) {
        const id = uuidv4();
        db.prepare(
          "INSERT INTO repository_rules (id, repo_id, content, source, source_comment_id, created_at, updated_at) VALUES (?, ?, ?, 'manual', NULL, ?, ?)",
        ).run(id, repoId ?? null, content, ts, ts);

        result.push({
          id,
          repo_id: repoId ?? null,
          content,
          source: 'manual',
          source_comment_id: null,
          created_at: ts,
          updated_at: ts,
        });
      }
    });
    tx();

    return result;
};
