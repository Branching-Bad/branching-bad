import { v4 as uuidv4 } from 'uuid';
import type {
  CreateTaskPayload,
  TaskWithPayload,
} from '../models.js';
import { Db, nowIso } from './index.js';

declare module './index.js' {
  interface Db {
    listTasksByRepo(repoId: string): TaskWithPayload[];
    getTaskById(taskId: string): TaskWithPayload | null;
    deleteTask(taskId: string): void;
    createManualTask(payload: CreateTaskPayload): TaskWithPayload;
    updateTaskStatus(taskId: string, status: string): void;
    updateTaskPipelineState(taskId: string, lastPipelineError?: string): void;
    updateTaskDetails(
      taskId: string,
      title: string,
      description: string | undefined,
      priority: string | undefined,
      requirePlan: boolean,
      autoStart: boolean,
      autoApprovePlan: boolean,
      useWorktree: boolean,
      carryDirtyState: boolean,
      agentProfileId?: string,
    ): void;
    updateTaskPr(taskId: string, prUrl: string, prNumber?: number): void;
  }
}

function rowToTask(row: any): TaskWithPayload {
  return {
    id: row.id,
    repo_id: row.repo_id,
    jira_account_id: row.jira_account_id,
    jira_board_id: row.jira_board_id,
    jira_issue_key: row.jira_issue_key,
    title: row.title,
    description: row.description,
    assignee: row.assignee,
    status: row.status,
    priority: row.priority,
    source: row.source,
    require_plan: !!row.require_plan,
    auto_start: !!row.auto_start,
    auto_approve_plan: !!row.auto_approve_plan,
    use_worktree: !!row.use_worktree,
    carry_dirty_state: !!row.carry_dirty_state,
    last_pipeline_error: row.last_pipeline_error,
    last_pipeline_at: row.last_pipeline_at,
    agent_profile_id: row.agent_profile_id,
    pr_url: row.pr_url,
    pr_number: row.pr_number,
    payload: JSON.parse(row.payload_json || '{}'),
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

const TASK_COLS =
  'id, repo_id, jira_account_id, jira_board_id, jira_issue_key, title, description, assignee, status, priority, source, require_plan, auto_start, auto_approve_plan, use_worktree, carry_dirty_state, last_pipeline_error, last_pipeline_at, agent_profile_id, pr_url, pr_number, payload_json, created_at, updated_at';

Db.prototype.listTasksByRepo = function (repoId: string): TaskWithPayload[] {
  const db = this.connect();
    const rows = db
      .prepare(`SELECT ${TASK_COLS} FROM tasks WHERE repo_id = ? ORDER BY updated_at DESC`)
      .all(repoId) as any[];
    return rows.map(rowToTask);
};

Db.prototype.getTaskById = function (taskId: string): TaskWithPayload | null {
  const db = this.connect();
    const row = db.prepare(`SELECT ${TASK_COLS} FROM tasks WHERE id = ?`).get(taskId) as
      | any
      | undefined;
    return row ? rowToTask(row) : null;
};

Db.prototype.deleteTask = function (taskId: string): void {
  const db = this.connect();
    const result = db.prepare('DELETE FROM tasks WHERE id = ?').run(taskId);
    if (Number(result.changes) === 0) {
      throw new Error(`Task not found: ${taskId}`);
    }
};

Db.prototype.createManualTask = function (payload: CreateTaskPayload): TaskWithPayload {
  const db = this.connect();
    const id = uuidv4();
    const ts = nowIso();
    const status = payload.status ?? 'To Do';
    const defaults = this.resolveTaskDefaults(payload.repoId);
    const requirePlan = payload.requirePlan ?? defaults.require_plan ?? true;
    const autoStart = payload.autoStart ?? defaults.auto_start ?? false;
    const autoApprovePlan = payload.autoApprovePlan ?? defaults.auto_approve_plan ?? false;
    const useWorktree = payload.useWorktree ?? defaults.use_worktree ?? true;
    const carryDirtyState = payload.carryDirtyState ?? defaults.carry_dirty_state ?? false;

    const maxLocal = db
      .prepare(
        "SELECT jira_issue_key FROM tasks WHERE jira_issue_key LIKE 'LOCAL-%' ORDER BY CAST(SUBSTR(jira_issue_key, 7) AS INTEGER) DESC LIMIT 1",
      )
      .get() as { jira_issue_key: string } | undefined;

    let nextNum = 1;
    if (maxLocal) {
      const prefix = 'LOCAL-';
      const numStr = maxLocal.jira_issue_key.slice(prefix.length);
      const parsed = parseInt(numStr, 10);
      if (!isNaN(parsed)) {
        nextNum = parsed + 1;
      }
    }
    const issueKey = `LOCAL-${nextNum}`;

    db.prepare(
      `INSERT INTO tasks (
         id, repo_id, jira_account_id, jira_board_id, jira_issue_key, title,
         description, assignee, status, priority, source, require_plan, auto_start,
         auto_approve_plan, use_worktree, carry_dirty_state, agent_profile_id, last_pipeline_error, last_pipeline_at, payload_json, created_at, updated_at
       ) VALUES (?, ?, NULL, NULL, ?, ?, ?, NULL, ?, ?, 'manual', ?, ?, ?, ?, ?, ?, NULL, NULL, '{}', ?, ?)`,
    ).run(
      id,
      payload.repoId,
      issueKey,
      payload.title,
      payload.description ?? null,
      status,
      payload.priority ?? null,
      requirePlan ? 1 : 0,
      autoStart ? 1 : 0,
      autoApprovePlan ? 1 : 0,
      useWorktree ? 1 : 0,
      carryDirtyState ? 1 : 0,
      payload.agentProfileId ?? null,
      ts,
      ts,
    );

    const row = db.prepare(`SELECT ${TASK_COLS} FROM tasks WHERE id = ?`).get(id) as any;
    return rowToTask(row);
};

Db.prototype.updateTaskStatus = function (taskId: string, status: string): void {
  const db = this.connect();
    db.prepare('UPDATE tasks SET status = ?, updated_at = ? WHERE id = ?').run(
      status,
      nowIso(),
      taskId,
    );
};

Db.prototype.updateTaskPipelineState = function (
  taskId: string,
  lastPipelineError?: string,
): void {
  const db = this.connect();
    const ts = nowIso();
    db.prepare(
      'UPDATE tasks SET last_pipeline_error = ?, last_pipeline_at = ?, updated_at = ? WHERE id = ?',
    ).run(lastPipelineError ?? null, ts, ts, taskId);
};

Db.prototype.updateTaskDetails = function (
  taskId: string,
  title: string,
  description: string | undefined,
  priority: string | undefined,
  requirePlan: boolean,
  autoStart: boolean,
  autoApprovePlan: boolean,
  useWorktree: boolean,
  carryDirtyState: boolean,
  agentProfileId?: string,
): void {
  const db = this.connect();
    db.prepare(
      'UPDATE tasks SET title = ?, description = ?, priority = ?, require_plan = ?, auto_start = ?, auto_approve_plan = ?, use_worktree = ?, carry_dirty_state = ?, agent_profile_id = ?, updated_at = ? WHERE id = ?',
    ).run(
      title,
      description ?? null,
      priority ?? null,
      requirePlan ? 1 : 0,
      autoStart ? 1 : 0,
      autoApprovePlan ? 1 : 0,
      useWorktree ? 1 : 0,
      carryDirtyState ? 1 : 0,
      agentProfileId ?? null,
      nowIso(),
      taskId,
    );
};

Db.prototype.updateTaskPr = function (
  taskId: string,
  prUrl: string,
  prNumber?: number,
): void {
  const db = this.connect();
    db.prepare('UPDATE tasks SET pr_url = ?, pr_number = ?, updated_at = ? WHERE id = ?').run(
      prUrl,
      prNumber ?? null,
      nowIso(),
      taskId,
    );
};
