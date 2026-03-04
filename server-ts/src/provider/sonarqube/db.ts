import type { SonarScan } from './models.js';
import { Db, nowIso } from '../../db/index.js';

declare module '../../db/index.js' {
  interface Db {
    insertSonarScan(
      id: string,
      repoId: string,
      accountId: string,
      projectKey: string,
    ): void;
    updateSonarScanStatus(
      id: string,
      status: string,
      issuesFound?: number,
      error?: string,
    ): void;
    getSonarScan(id: string): SonarScan | null;
    listSonarScansByRepo(repoId: string): SonarScan[];
  }
}

const SCAN_COLS =
  'id, repo_id, account_id, project_key, status, issues_found, error, created_at, completed_at';

function rowToSonarScan(row: any): SonarScan {
  return {
    id: row.id,
    repo_id: row.repo_id,
    account_id: row.account_id,
    project_key: row.project_key,
    status: row.status,
    issues_found: row.issues_found,
    error: row.error,
    created_at: row.created_at,
    completed_at: row.completed_at,
  };
}

Db.prototype.insertSonarScan = function (
  id: string,
  repoId: string,
  accountId: string,
  projectKey: string,
): void {
  const db = this.connect();
    db.prepare(
      "INSERT INTO sonar_scans (id, repo_id, account_id, project_key, status, created_at) VALUES (?, ?, ?, ?, 'running', ?)",
    ).run(id, repoId, accountId, projectKey, nowIso());
};

Db.prototype.updateSonarScanStatus = function (
  id: string,
  status: string,
  issuesFound?: number,
  error?: string,
): void {
  const db = this.connect();
    const isTerminal = status === 'completed' || status === 'failed';
    const completedAt = isTerminal ? nowIso() : null;
    db.prepare(
      'UPDATE sonar_scans SET status = ?, issues_found = ?, error = ?, completed_at = COALESCE(?, completed_at) WHERE id = ?',
    ).run(status, issuesFound ?? null, error ?? null, completedAt, id);
};

Db.prototype.getSonarScan = function (id: string): SonarScan | null {
  const db = this.connect();
    const row = db
      .prepare(`SELECT ${SCAN_COLS} FROM sonar_scans WHERE id = ?`)
      .get(id) as any | undefined;
    return row ? rowToSonarScan(row) : null;
};

Db.prototype.listSonarScansByRepo = function (repoId: string): SonarScan[] {
  const db = this.connect();
    const rows = db
      .prepare(
        `SELECT ${SCAN_COLS} FROM sonar_scans WHERE repo_id = ? ORDER BY created_at DESC LIMIT 20`,
      )
      .all(repoId) as any[];
    return rows.map(rowToSonarScan);
};
