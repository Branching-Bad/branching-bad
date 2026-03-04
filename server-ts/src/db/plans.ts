import { v4 as uuidv4 } from 'uuid';
import type { Plan, PlanWithParsed } from '../models.js';
import { Db, nowIso } from './index.js';

declare module './index.js' {
  interface Db {
    createPlan(
      taskId: string,
      status: string,
      planMarkdown: string,
      tasklistJson: any,
      tasklistSchemaVersion: number,
      generationMode: string,
      validationErrorsJson: any | undefined,
      createdBy: string,
    ): Plan;
    getNextPlanVersion(taskId: string): number;
    listPlansByTask(taskId: string): PlanWithParsed[];
    getPlanById(planId: string): PlanWithParsed | null;
    updatePlanStatus(planId: string, status: string): void;
    addPlanAction(planId: string, action: string, comment: string | undefined, actor: string): void;
  }
}

const PLAN_COLS =
  'id, task_id, version, status, plan_markdown, tasklist_json, tasklist_schema_version, generation_mode, validation_errors_json, created_by, created_at, updated_at';

function rowToPlanWithParsed(row: any): PlanWithParsed {
  return {
    id: row.id,
    task_id: row.task_id,
    version: row.version,
    status: row.status,
    plan_markdown: row.plan_markdown,
    tasklist: JSON.parse(row.tasklist_json || '{}'),
    tasklist_schema_version: row.tasklist_schema_version,
    generation_mode: row.generation_mode,
    validation_errors: row.validation_errors_json
      ? JSON.parse(row.validation_errors_json)
      : null,
    created_by: row.created_by,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

Db.prototype.createPlan = function (
  taskId: string,
  status: string,
  planMarkdown: string,
  tasklistJson: any,
  tasklistSchemaVersion: number,
  generationMode: string,
  validationErrorsJson: any | undefined,
  createdBy: string,
): Plan {
  const db = this.connect();
    const currentVersion = db
      .prepare('SELECT version FROM plans WHERE task_id = ? ORDER BY version DESC LIMIT 1')
      .get(taskId) as { version: number } | undefined;
    const version = (currentVersion?.version ?? 0) + 1;
    const ts = nowIso();
    const id = uuidv4();

    db.prepare(
      'INSERT INTO plans (id, task_id, version, status, plan_markdown, plan_json, tasklist_json, tasklist_schema_version, generation_mode, validation_errors_json, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    ).run(
      id,
      taskId,
      version,
      status,
      planMarkdown,
      '{}',
      JSON.stringify(tasklistJson),
      tasklistSchemaVersion,
      generationMode,
      validationErrorsJson != null ? JSON.stringify(validationErrorsJson) : null,
      createdBy,
      ts,
      ts,
    );

    const parsed = this.getPlanById(id)!;
    return {
      id: parsed.id,
      task_id: parsed.task_id,
      version: parsed.version,
      status: parsed.status,
      plan_markdown: parsed.plan_markdown,
      tasklist_json: JSON.stringify(parsed.tasklist),
      tasklist_schema_version: parsed.tasklist_schema_version,
      generation_mode: parsed.generation_mode,
      validation_errors_json: parsed.validation_errors
        ? JSON.stringify(parsed.validation_errors)
        : null,
      created_by: parsed.created_by,
      created_at: parsed.created_at,
      updated_at: parsed.updated_at,
    };
};

Db.prototype.getNextPlanVersion = function (taskId: string): number {
  const db = this.connect();
    const row = db
      .prepare('SELECT version FROM plans WHERE task_id = ? ORDER BY version DESC LIMIT 1')
      .get(taskId) as { version: number } | undefined;
    return (row?.version ?? 0) + 1;
};

Db.prototype.listPlansByTask = function (taskId: string): PlanWithParsed[] {
  const db = this.connect();
    const rows = db
      .prepare(`SELECT ${PLAN_COLS} FROM plans WHERE task_id = ? ORDER BY version DESC`)
      .all(taskId) as any[];
    return rows.map(rowToPlanWithParsed);
};

Db.prototype.getPlanById = function (planId: string): PlanWithParsed | null {
  const db = this.connect();
    const row = db.prepare(`SELECT ${PLAN_COLS} FROM plans WHERE id = ?`).get(planId) as
      | any
      | undefined;
    return row ? rowToPlanWithParsed(row) : null;
};

Db.prototype.updatePlanStatus = function (planId: string, status: string): void {
  const db = this.connect();
    db.prepare('UPDATE plans SET status = ?, updated_at = ? WHERE id = ?').run(
      status,
      nowIso(),
      planId,
    );
};

Db.prototype.addPlanAction = function (
  planId: string,
  action: string,
  comment: string | undefined,
  actor: string,
): void {
  const db = this.connect();
    db.prepare(
      'INSERT INTO plan_actions (id, plan_id, action, comment, actor, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    ).run(uuidv4(), planId, action, comment ?? null, actor, nowIso());
};
