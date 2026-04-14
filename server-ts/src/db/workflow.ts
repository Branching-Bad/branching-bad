import { Db, nowIso } from './index.js';
import type {
  Graph, Workflow, WorkflowRun, NodeAttempt, RunTrigger, RunStatus, AttemptStatus,
} from '../workflow/model.js';

declare module './index.js' {
  interface Db {
    createWorkflow(id: string, repoId: string, name: string, graph: Graph): Workflow;
    updateWorkflow(id: string, patch: {
      name?: string; graph?: Graph; cron?: string | null; cron_enabled?: boolean;
    }): void;
    getWorkflow(id: string): Workflow | null;
    listWorkflows(repoId: string): Workflow[];
    listCronEnabledWorkflows(): Workflow[];
    deleteWorkflow(id: string): void;

    createWorkflowRun(id: string, workflowId: string, trigger: RunTrigger, snapshot: Graph): WorkflowRun;
    updateWorkflowRunStatus(id: string, status: RunStatus, endedAt: string | null): void;
    getWorkflowRun(id: string): WorkflowRun | null;
    listWorkflowRuns(workflowId: string, limit: number): WorkflowRun[];
    listRunningWorkflowRuns(): WorkflowRun[];

    createAttempt(a: {
      id: string; runId: string; nodeId: string; attemptNum: number;
    }): NodeAttempt;
    updateAttempt(id: string, patch: {
      status?: AttemptStatus;
      started_at?: string | null;
      ended_at?: string | null;
      exit_code?: number | null;
      duration_ms?: number | null;
      stdout_inline?: string | null;
      stderr_inline?: string | null;
      stdout_file?: string | null;
      stderr_file?: string | null;
    }): void;
    getAttempt(id: string): NodeAttempt | null;
    listAttempts(runId: string): NodeAttempt[];
    getLatestAttempt(runId: string, nodeId: string): NodeAttempt | null;
  }
}

const rowToWorkflow = (r: any): Workflow => ({
  id: r.id,
  repo_id: r.repo_id,
  name: r.name,
  graph: JSON.parse(r.graph_json),
  cron: r.cron,
  cron_enabled: !!r.cron_enabled,
  created_at: r.created_at,
  updated_at: r.updated_at,
});

const rowToRun = (r: any): WorkflowRun => ({
  id: r.id,
  workflow_id: r.workflow_id,
  trigger: r.trigger,
  status: r.status,
  started_at: r.started_at,
  ended_at: r.ended_at,
  snapshot: JSON.parse(r.snapshot_json),
});

const rowToAttempt = (r: any): NodeAttempt => ({
  id: r.id,
  run_id: r.run_id,
  node_id: r.node_id,
  attempt_num: r.attempt_num,
  status: r.status,
  started_at: r.started_at,
  ended_at: r.ended_at,
  exit_code: r.exit_code,
  duration_ms: r.duration_ms,
  stdout_inline: r.stdout_inline,
  stderr_inline: r.stderr_inline,
  stdout_file: r.stdout_file,
  stderr_file: r.stderr_file,
});

Db.prototype.createWorkflow = function (id, repoId, name, graph) {
  const ts = nowIso();
  this.connect().prepare(
    `INSERT INTO workflows (id, repo_id, name, graph_json, cron, cron_enabled, created_at, updated_at)
     VALUES (?, ?, ?, ?, NULL, 0, ?, ?)`,
  ).run(id, repoId, name, JSON.stringify(graph), ts, ts);
  return this.getWorkflow(id)!;
};

Db.prototype.updateWorkflow = function (id, patch) {
  const parts: string[] = [];
  const vals: any[] = [];
  if (patch.name !== undefined) { parts.push('name = ?'); vals.push(patch.name); }
  if (patch.graph !== undefined) { parts.push('graph_json = ?'); vals.push(JSON.stringify(patch.graph)); }
  if (patch.cron !== undefined) { parts.push('cron = ?'); vals.push(patch.cron); }
  if (patch.cron_enabled !== undefined) { parts.push('cron_enabled = ?'); vals.push(patch.cron_enabled ? 1 : 0); }
  parts.push('updated_at = ?'); vals.push(nowIso());
  vals.push(id);
  this.connect().prepare(`UPDATE workflows SET ${parts.join(', ')} WHERE id = ?`).run(...vals);
};

Db.prototype.getWorkflow = function (id) {
  const row = this.connect().prepare('SELECT * FROM workflows WHERE id = ?').get(id);
  return row ? rowToWorkflow(row) : null;
};

Db.prototype.listWorkflows = function (repoId) {
  return this.connect().prepare('SELECT * FROM workflows WHERE repo_id = ? ORDER BY updated_at DESC')
    .all(repoId).map(rowToWorkflow);
};

Db.prototype.listCronEnabledWorkflows = function () {
  return this.connect().prepare('SELECT * FROM workflows WHERE cron_enabled = 1 AND cron IS NOT NULL')
    .all().map(rowToWorkflow);
};

Db.prototype.deleteWorkflow = function (id) {
  this.connect().prepare('DELETE FROM workflows WHERE id = ?').run(id);
};

Db.prototype.createWorkflowRun = function (id, workflowId, trigger, snapshot) {
  const ts = nowIso();
  this.connect().prepare(
    `INSERT INTO workflow_runs (id, workflow_id, trigger, status, started_at, ended_at, snapshot_json)
     VALUES (?, ?, ?, 'running', ?, NULL, ?)`,
  ).run(id, workflowId, trigger, ts, JSON.stringify(snapshot));
  return this.getWorkflowRun(id)!;
};

Db.prototype.updateWorkflowRunStatus = function (id, status, endedAt) {
  this.connect().prepare('UPDATE workflow_runs SET status = ?, ended_at = ? WHERE id = ?').run(status, endedAt, id);
};

Db.prototype.getWorkflowRun = function (id) {
  const row = this.connect().prepare('SELECT * FROM workflow_runs WHERE id = ?').get(id);
  return row ? rowToRun(row) : null;
};

Db.prototype.listWorkflowRuns = function (workflowId, limit) {
  return this.connect().prepare(
    'SELECT * FROM workflow_runs WHERE workflow_id = ? ORDER BY started_at DESC LIMIT ?',
  ).all(workflowId, limit).map(rowToRun);
};

Db.prototype.listRunningWorkflowRuns = function () {
  return this.connect().prepare("SELECT * FROM workflow_runs WHERE status = 'running'").all().map(rowToRun);
};

Db.prototype.createAttempt = function (a) {
  this.connect().prepare(
    `INSERT INTO workflow_node_attempts (id, run_id, node_id, attempt_num, status)
     VALUES (?, ?, ?, ?, 'pending')`,
  ).run(a.id, a.runId, a.nodeId, a.attemptNum);
  return this.getAttempt(a.id)!;
};

Db.prototype.updateAttempt = function (id, patch) {
  const parts: string[] = [];
  const vals: any[] = [];
  for (const k of [
    'status', 'started_at', 'ended_at', 'exit_code', 'duration_ms',
    'stdout_inline', 'stderr_inline', 'stdout_file', 'stderr_file',
  ] as const) {
    if (patch[k] !== undefined) { parts.push(`${k} = ?`); vals.push(patch[k]); }
  }
  if (parts.length === 0) return;
  vals.push(id);
  this.connect().prepare(`UPDATE workflow_node_attempts SET ${parts.join(', ')} WHERE id = ?`).run(...vals);
};

Db.prototype.getAttempt = function (id) {
  const row = this.connect().prepare('SELECT * FROM workflow_node_attempts WHERE id = ?').get(id);
  return row ? rowToAttempt(row) : null;
};

Db.prototype.listAttempts = function (runId) {
  return this.connect().prepare(
    'SELECT * FROM workflow_node_attempts WHERE run_id = ? ORDER BY node_id, attempt_num',
  ).all(runId).map(rowToAttempt);
};

Db.prototype.getLatestAttempt = function (runId, nodeId) {
  const row = this.connect().prepare(
    `SELECT * FROM workflow_node_attempts WHERE run_id = ? AND node_id = ?
     ORDER BY attempt_num DESC LIMIT 1`,
  ).get(runId, nodeId);
  return row ? rowToAttempt(row) : null;
};
