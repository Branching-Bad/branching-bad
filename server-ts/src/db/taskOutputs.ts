import { Db, nowIso } from './index.js';

export interface TaskOutput {
  id: number;
  task_id: string;
  type: string;
  data: string;
  created_at: string;
}

declare module './index.js' {
  interface Db {
    pushTaskOutput(taskId: string, type: string, data: string): void;
    listTaskOutputs(taskId: string, limit?: number): TaskOutput[];
    clearTaskOutputs(taskId?: string): void;
  }
}

const MAX_OUTPUTS_PER_TASK = 100;
const TRIM_INTERVAL = 20;
const trimCounters = new Map<string, number>();

Db.prototype.pushTaskOutput = function (
  taskId: string,
  type: string,
  data: string,
): void {
  const db = this.connect();
  db.prepare(
    'INSERT INTO task_outputs (task_id, type, data, created_at) VALUES (?, ?, ?, ?)',
  ).run(taskId, type, data, nowIso());

  // Trim periodically instead of on every insert
  const count = (trimCounters.get(taskId) ?? 0) + 1;
  trimCounters.set(taskId, count);
  if (count >= TRIM_INTERVAL) {
    trimCounters.delete(taskId);
    db.prepare(
      `DELETE FROM task_outputs WHERE task_id = ? AND id NOT IN (
        SELECT id FROM task_outputs WHERE task_id = ? ORDER BY id DESC LIMIT ?
      )`,
    ).run(taskId, taskId, MAX_OUTPUTS_PER_TASK);
  }
};

Db.prototype.listTaskOutputs = function (
  taskId: string,
  limit?: number,
): TaskOutput[] {
  const db = this.connect();
  return db
    .prepare(
      'SELECT id, task_id, type, data, created_at FROM task_outputs WHERE task_id = ? ORDER BY id ASC LIMIT ?',
    )
    .all(taskId, limit ?? MAX_OUTPUTS_PER_TASK) as any[];
};

Db.prototype.clearTaskOutputs = function (taskId?: string): void {
  const db = this.connect();
  if (taskId) {
    db.prepare('DELETE FROM task_outputs WHERE task_id = ?').run(taskId);
  } else {
    db.prepare('DELETE FROM task_outputs').run();
  }
};
