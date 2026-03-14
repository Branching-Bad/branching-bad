import type { TaskDefaults } from '../models.js';
import { Db } from './index.js';

declare module './index.js' {
  interface Db {
    getTaskDefaults(repoId: string, providerName?: string | null): TaskDefaults | null;
    listTaskDefaults(repoId: string): TaskDefaults[];
    upsertTaskDefaults(
      repoId: string,
      providerName: string | null,
      fields: Partial<Omit<TaskDefaults, 'id' | 'repo_id' | 'provider_name'>>,
    ): TaskDefaults;
    deleteTaskDefaults(repoId: string, providerName: string | null): void;
    resolveTaskDefaults(repoId: string, providerName?: string | null): Partial<TaskDefaults>;
  }
}

function rowToDefaults(row: any): TaskDefaults {
  return {
    id: row.id,
    repo_id: row.repo_id,
    provider_name: row.provider_name ?? null,
    require_plan: !!row.require_plan,
    auto_start: !!row.auto_start,
    auto_approve_plan: !!row.auto_approve_plan,
    use_worktree: !!row.use_worktree,
    carry_dirty_state: !!row.carry_dirty_state,
    priority: row.priority ?? null,
  };
}

Db.prototype.getTaskDefaults = function (
  repoId: string,
  providerName?: string | null,
): TaskDefaults | null {
  const db = this.connect();
  const row = db
    .prepare(
      'SELECT * FROM task_defaults WHERE repo_id = ? AND (provider_name IS ? OR provider_name = ?)',
    )
    .get(repoId, providerName ?? null, providerName ?? null) as any;
  return row ? rowToDefaults(row) : null;
};

Db.prototype.listTaskDefaults = function (repoId: string): TaskDefaults[] {
  const db = this.connect();
  const rows = db
    .prepare('SELECT * FROM task_defaults WHERE repo_id = ? ORDER BY provider_name ASC NULLS FIRST')
    .all(repoId) as any[];
  return rows.map(rowToDefaults);
};

Db.prototype.upsertTaskDefaults = function (
  repoId: string,
  providerName: string | null,
  fields: Partial<Omit<TaskDefaults, 'id' | 'repo_id' | 'provider_name'>>,
): TaskDefaults {
  const db = this.connect();
  // SQLite UNIQUE doesn't match NULL = NULL, so delete-then-insert for NULL provider
  if (providerName === null) {
    db.prepare('DELETE FROM task_defaults WHERE repo_id = ? AND provider_name IS NULL').run(repoId);
  } else {
    db.prepare('DELETE FROM task_defaults WHERE repo_id = ? AND provider_name = ?').run(repoId, providerName);
  }
  db.prepare(
    `INSERT INTO task_defaults
       (repo_id, provider_name, require_plan, auto_start, auto_approve_plan, use_worktree, carry_dirty_state, priority)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    repoId,
    providerName,
    fields.require_plan !== undefined ? (fields.require_plan ? 1 : 0) : 1,
    fields.auto_start !== undefined ? (fields.auto_start ? 1 : 0) : 0,
    fields.auto_approve_plan !== undefined ? (fields.auto_approve_plan ? 1 : 0) : 0,
    fields.use_worktree !== undefined ? (fields.use_worktree ? 1 : 0) : 1,
    fields.carry_dirty_state !== undefined ? (fields.carry_dirty_state ? 1 : 0) : 0,
    fields.priority ?? null,
  );
  return this.getTaskDefaults(repoId, providerName) as TaskDefaults;
};

Db.prototype.deleteTaskDefaults = function (
  repoId: string,
  providerName: string | null,
): void {
  const db = this.connect();
  db.prepare(
    'DELETE FROM task_defaults WHERE repo_id = ? AND (provider_name IS ? OR provider_name = ?)',
  ).run(repoId, providerName, providerName);
};

Db.prototype.resolveTaskDefaults = function (
  repoId: string,
  providerName?: string | null,
): Partial<TaskDefaults> {
  // 3-tier: provider override → repo default → empty object
  if (providerName) {
    const providerDefaults = this.getTaskDefaults(repoId, providerName);
    if (providerDefaults) return providerDefaults;
  }
  const repoDefaults = this.getTaskDefaults(repoId, null);
  if (repoDefaults) return repoDefaults;
  return {};
};
