import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import type { Repo } from '../models.js';
import { Db, nowIso } from './index.js';

declare module './index.js' {
  interface Db {
    createOrUpdateRepo(repoPath: string, name?: string): Repo;
    listRepos(): Repo[];
    getRepoById(id: string): Repo | null;
    updateRepoDefaultBranch(id: string, defaultBranch: string): void;
    updateRepoBuildCommand(id: string, buildCommand: string | null): void;
    updateRepoQueueMode(id: string, enabled: boolean): void;
  }
}

function rowToRepo(row: any): Repo {
  return {
    id: row.id,
    name: row.name,
    path: row.path,
    default_branch: row.default_branch,
    build_command: row.build_command,
    queue_mode: !!row.queue_mode,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

Db.prototype.createOrUpdateRepo = function (repoPath: string, name?: string): Repo {
  const db = this.connect();
    const existing = db
      .prepare(
        'SELECT id, name, path, default_branch, build_command, queue_mode, created_at, updated_at FROM repos WHERE path = ?',
      )
      .get(repoPath) as any | undefined;
    const ts = nowIso();

    if (existing) {
      const updatedName = name || existing.name;
      db.prepare('UPDATE repos SET name = ?, updated_at = ? WHERE id = ?').run(
        updatedName,
        ts,
        existing.id,
      );
      const updated = db
        .prepare(
          'SELECT id, name, path, default_branch, build_command, queue_mode, created_at, updated_at FROM repos WHERE id = ?',
        )
        .get(existing.id) as any;
      return rowToRepo(updated);
    }

    const derivedName =
      name && name.trim() ? name : path.basename(repoPath) || 'repo';

    const repo: Repo = {
      id: uuidv4(),
      name: derivedName,
      path: repoPath,
      default_branch: 'main',
      build_command: null,
      queue_mode: false,
      created_at: ts,
      updated_at: ts,
    };
    db.prepare(
      'INSERT INTO repos (id, name, path, default_branch, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
    ).run(repo.id, repo.name, repo.path, repo.default_branch, repo.created_at, repo.updated_at);
    return repo;
};

Db.prototype.listRepos = function (): Repo[] {
  const db = this.connect();
    const rows = db
      .prepare(
        'SELECT id, name, path, default_branch, build_command, queue_mode, created_at, updated_at FROM repos ORDER BY updated_at DESC',
      )
      .all() as any[];
    return rows.map(rowToRepo);
};

Db.prototype.getRepoById = function (id: string): Repo | null {
  const db = this.connect();
    const row = db
      .prepare(
        'SELECT id, name, path, default_branch, build_command, queue_mode, created_at, updated_at FROM repos WHERE id = ?',
      )
      .get(id) as any | undefined;
    return row ? rowToRepo(row) : null;
};

Db.prototype.updateRepoDefaultBranch = function (id: string, defaultBranch: string): void {
  const db = this.connect();
    db.prepare('UPDATE repos SET default_branch = ?, updated_at = ? WHERE id = ?').run(
      defaultBranch,
      nowIso(),
      id,
    );
};

Db.prototype.updateRepoBuildCommand = function (id: string, buildCommand: string | null): void {
  const db = this.connect();
  db.prepare('UPDATE repos SET build_command = ?, updated_at = ? WHERE id = ?').run(
    buildCommand,
    nowIso(),
    id,
  );
};

Db.prototype.updateRepoQueueMode = function (id: string, enabled: boolean): void {
  const db = this.connect();
  db.prepare('UPDATE repos SET queue_mode = ?, updated_at = ? WHERE id = ?').run(
    enabled ? 1 : 0,
    nowIso(),
    id,
  );
};
