import { v4 as uuidv4 } from 'uuid';
import type { Run, RunEvent } from '../models.js';
import { Db, nowIso } from './index.js';

declare module './index.js' {
  interface Db {
    createRun(
      taskId: string,
      planId: string | null,
      status: string,
      branchName: string,
      agentProfileId?: string,
      worktreePath?: string,
      baseSha?: string,
    ): Run;
    updateRunStatus(runId: string, status: string, completed: boolean): void;
    getRunById(runId: string): Run | null;
    addRunEvent(runId: string, eventType: string, payload: any): void;
    listRunEvents(runId: string): RunEvent[];
    updateRunPid(runId: string, pid: number): void;
    updateRunExitCode(runId: string, exitCode?: number): void;
    getLatestRunByTask(taskId: string): Run | null;
    updateRunSessionId(runId: string, sessionId: string): void;
    updateRunWorktreePath(runId: string, worktreePath: string): void;
    updateRunChatMessageId(runId: string, chatMessageId: string): void;
    updateRunReviewCommentId(runId: string, reviewCommentId: string): void;
    getRunsWithWorktreeByTask(taskId: string): Array<{ worktree_path: string | null; branch_name: string }>;
  }
}

const RUN_COLS =
  'id, task_id, plan_id, status, branch_name, agent_profile_id, pid, exit_code, agent_session_id, review_comment_id, chat_message_id, worktree_path, base_sha, started_at, completed_at, created_at, updated_at';

function rowToRun(row: any): Run {
  return {
    id: row.id,
    task_id: row.task_id,
    plan_id: row.plan_id,
    status: row.status,
    branch_name: row.branch_name,
    agent_profile_id: row.agent_profile_id,
    pid: row.pid,
    exit_code: row.exit_code,
    agent_session_id: row.agent_session_id,
    review_comment_id: row.review_comment_id,
    chat_message_id: row.chat_message_id,
    worktree_path: row.worktree_path,
    base_sha: row.base_sha,
    started_at: row.started_at,
    completed_at: row.completed_at,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

Db.prototype.createRun = function (
  taskId: string,
  planId: string | null,
  status: string,
  branchName: string,
  agentProfileId?: string,
  worktreePath?: string,
  baseSha?: string,
): Run {
  const db = this.connect();
    const id = uuidv4();
    const ts = nowIso();
    const startedAt = status === 'running' ? ts : null;

    db.prepare(
      'INSERT INTO runs (id, task_id, plan_id, status, branch_name, agent_profile_id, pid, exit_code, worktree_path, base_sha, started_at, completed_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?, ?, NULL, ?, ?)',
    ).run(
      id,
      taskId,
      planId,
      status,
      branchName,
      agentProfileId ?? null,
      worktreePath ?? null,
      baseSha ?? null,
      startedAt,
      ts,
      ts,
    );

    const row = db.prepare(`SELECT ${RUN_COLS} FROM runs WHERE id = ?`).get(id) as any;
    return rowToRun(row);
};

Db.prototype.updateRunStatus = function (
  runId: string,
  status: string,
  completed: boolean,
): void {
  const db = this.connect();
    const completedAt = completed ? nowIso() : null;
    db.prepare(
      'UPDATE runs SET status = ?, completed_at = ?, updated_at = ? WHERE id = ?',
    ).run(status, completedAt, nowIso(), runId);
};

Db.prototype.getRunById = function (runId: string): Run | null {
  const db = this.connect();
    const row = db.prepare(`SELECT ${RUN_COLS} FROM runs WHERE id = ?`).get(runId) as
      | any
      | undefined;
    return row ? rowToRun(row) : null;
};

Db.prototype.addRunEvent = function (runId: string, eventType: string, payload: any): void {
  const db = this.connect();
    db.prepare(
      'INSERT INTO events (id, run_id, type, payload_json, created_at) VALUES (?, ?, ?, ?, ?)',
    ).run(uuidv4(), runId, eventType, JSON.stringify(payload), nowIso());
};

Db.prototype.listRunEvents = function (runId: string): RunEvent[] {
  const db = this.connect();
    const rows = db
      .prepare(
        'SELECT id, run_id, type, payload_json, created_at FROM events WHERE run_id = ? ORDER BY created_at ASC',
      )
      .all(runId) as any[];
    return rows.map((row) => ({
      id: row.id,
      run_id: row.run_id,
      type: row.type,
      payload: JSON.parse(row.payload_json || '{}'),
      created_at: row.created_at,
    }));
};

Db.prototype.updateRunPid = function (runId: string, pid: number): void {
  const db = this.connect();
    db.prepare('UPDATE runs SET pid = ?, updated_at = ? WHERE id = ?').run(
      pid,
      nowIso(),
      runId,
    );
};

Db.prototype.updateRunExitCode = function (runId: string, exitCode?: number): void {
  const db = this.connect();
    db.prepare('UPDATE runs SET exit_code = ?, updated_at = ? WHERE id = ?').run(
      exitCode ?? null,
      nowIso(),
      runId,
    );
};

Db.prototype.getLatestRunByTask = function (taskId: string): Run | null {
  const db = this.connect();
    const row = db
      .prepare(
        `SELECT ${RUN_COLS} FROM runs WHERE task_id = ? ORDER BY created_at DESC LIMIT 1`,
      )
      .get(taskId) as any | undefined;
    return row ? rowToRun(row) : null;
};

Db.prototype.updateRunSessionId = function (runId: string, sessionId: string): void {
  const db = this.connect();
    db.prepare('UPDATE runs SET agent_session_id = ?, updated_at = ? WHERE id = ?').run(
      sessionId,
      nowIso(),
      runId,
    );
};

Db.prototype.updateRunWorktreePath = function (runId: string, worktreePath: string): void {
  const db = this.connect();
    db.prepare('UPDATE runs SET worktree_path = ?, updated_at = ? WHERE id = ?').run(
      worktreePath,
      nowIso(),
      runId,
    );
};

Db.prototype.updateRunChatMessageId = function (
  runId: string,
  chatMessageId: string,
): void {
  const db = this.connect();
    db.prepare('UPDATE runs SET chat_message_id = ?, updated_at = ? WHERE id = ?').run(
      chatMessageId,
      nowIso(),
      runId,
    );
};

Db.prototype.getRunsWithWorktreeByTask = function (
  taskId: string,
): Array<{ worktree_path: string | null; branch_name: string }> {
  const db = this.connect();
  return db
    .prepare(
      `SELECT DISTINCT worktree_path, branch_name FROM runs
       WHERE task_id = ? AND (worktree_path IS NOT NULL OR branch_name IS NOT NULL)`,
    )
    .all(taskId) as Array<{ worktree_path: string | null; branch_name: string }>;
};

Db.prototype.updateRunReviewCommentId = function (
  runId: string,
  reviewCommentId: string,
): void {
  const db = this.connect();
    db.prepare('UPDATE runs SET review_comment_id = ?, updated_at = ? WHERE id = ?').run(
      reviewCommentId,
      nowIso(),
      runId,
    );
};
