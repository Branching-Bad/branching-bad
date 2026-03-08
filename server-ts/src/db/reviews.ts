import { v4 as uuidv4 } from 'uuid';
import type { ReviewComment } from '../models.js';
import { Db, nowIso } from './index.js';

declare module './index.js' {
  interface Db {
    addReviewCommentFull(
      taskId: string,
      runId: string,
      comment: string,
      filePath?: string,
      lineStart?: number,
      lineEnd?: number,
      diffHunk?: string,
      reviewMode?: string,
      batchId?: string,
    ): ReviewComment;
    listReviewComments(taskId: string): ReviewComment[];
    getReviewCommentById(id: string): ReviewComment | null;
    updateReviewCommentStatus(
      id: string,
      status: string,
      resultRunId?: string,
    ): void;
    updateReviewCommentText(id: string, comment: string): void;
    deleteReviewComment(id: string): void;
    saveRunDiff(runId: string, diffText: string): void;
    getRunDiff(runId: string): string | null;
  }
}

const REVIEW_COLS =
  'id, task_id, run_id, comment, status, result_run_id, addressed_at, created_at, file_path, line_start, line_end, diff_hunk, review_mode, batch_id';

function rowToReviewComment(row: any): ReviewComment {
  return {
    id: row.id,
    task_id: row.task_id,
    run_id: row.run_id,
    comment: row.comment,
    status: row.status,
    result_run_id: row.result_run_id,
    addressed_at: row.addressed_at,
    created_at: row.created_at,
    file_path: row.file_path,
    line_start: row.line_start,
    line_end: row.line_end,
    diff_hunk: row.diff_hunk,
    review_mode: row.review_mode ?? 'instant',
    batch_id: row.batch_id,
  };
}

Db.prototype.addReviewCommentFull = function (
  taskId: string,
  runId: string,
  comment: string,
  filePath?: string,
  lineStart?: number,
  lineEnd?: number,
  diffHunk?: string,
  reviewMode?: string,
  batchId?: string,
): ReviewComment {
  const db = this.connect();
    const id = uuidv4();
    const ts = nowIso();
    const mode = reviewMode ?? 'instant';

    db.prepare(
      "INSERT INTO review_comments (id, task_id, run_id, comment, status, file_path, line_start, line_end, diff_hunk, review_mode, batch_id, created_at) VALUES (?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?, ?, ?)",
    ).run(
      id,
      taskId,
      runId,
      comment,
      filePath ?? null,
      lineStart ?? null,
      lineEnd ?? null,
      diffHunk ?? null,
      mode,
      batchId ?? null,
      ts,
    );

    return {
      id,
      task_id: taskId,
      run_id: runId,
      comment,
      status: 'pending',
      result_run_id: null,
      addressed_at: null,
      created_at: ts,
      file_path: filePath ?? null,
      line_start: lineStart ?? null,
      line_end: lineEnd ?? null,
      diff_hunk: diffHunk ?? null,
      review_mode: mode,
      batch_id: batchId ?? null,
    };
};

Db.prototype.listReviewComments = function (taskId: string): ReviewComment[] {
  const db = this.connect();
    const rows = db
      .prepare(
        `SELECT ${REVIEW_COLS} FROM review_comments WHERE task_id = ? ORDER BY created_at ASC`,
      )
      .all(taskId) as any[];
    return rows.map(rowToReviewComment);
};

Db.prototype.getReviewCommentById = function (id: string): ReviewComment | null {
  const db = this.connect();
    const row = db
      .prepare(`SELECT ${REVIEW_COLS} FROM review_comments WHERE id = ?`)
      .get(id) as any | undefined;
    return row ? rowToReviewComment(row) : null;
};

Db.prototype.updateReviewCommentStatus = function (
  id: string,
  status: string,
  resultRunId?: string,
): void {
  const db = this.connect();
    const addressedAt = status === 'addressed' ? nowIso() : null;
    db.prepare(
      'UPDATE review_comments SET status = ?, result_run_id = ?, addressed_at = ? WHERE id = ?',
    ).run(status, resultRunId ?? null, addressedAt, id);
};

Db.prototype.updateReviewCommentText = function (id: string, comment: string): void {
  const db = this.connect();
  db.prepare('UPDATE review_comments SET comment = ? WHERE id = ?').run(comment, id);
};

Db.prototype.deleteReviewComment = function (id: string): void {
  const db = this.connect();
  db.prepare('DELETE FROM review_comments WHERE id = ?').run(id);
};

Db.prototype.saveRunDiff = function (runId: string, diffText: string): void {
  const db = this.connect();
    db.prepare(
      'INSERT OR REPLACE INTO run_diffs (run_id, diff_text, created_at) VALUES (?, ?, ?)',
    ).run(runId, diffText, nowIso());
};

Db.prototype.getRunDiff = function (runId: string): string | null {
  const db = this.connect();
    const row = db
      .prepare('SELECT diff_text FROM run_diffs WHERE run_id = ?')
      .get(runId) as { diff_text: string } | undefined;
    return row?.diff_text ?? null;
};
