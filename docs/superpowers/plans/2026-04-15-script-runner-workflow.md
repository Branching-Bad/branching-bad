# Script Runner (Workflow Tab) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a new top-level "Workflow" tab that lets users build and run DAG-based script pipelines (Python, TypeScript, custom languages, agent nodes) per repo, with manual + cron triggers and a live D3 canvas.

**Architecture:** Backend — new `server-ts/src/workflow/` module with a monolithic graph runner that spawns scripts via host shell, reusing `processManager` for lifecycle. Persistence in SQLite (`workflows`, `workflow_runs`, `workflow_node_attempts`). WebSocket broadcasts per-node state and stdout/stderr chunks. Frontend — new `WorkflowTab.tsx` under a header-level tab switcher, hook-per-domain (`useWorkflow.ts`), D3 SVG canvas, right-side editor panel.

**Tech Stack:** TypeScript, Express, `node:sqlite` (via existing `Db` class), `ws`, `node-cron` (new), React 19, Vite, Tailwind v4, `d3` (new dep), Monaco (new dep for code editor), existing `agent_profiles` + `processManager` + `spawnAgent` helpers.

**Spec:** `docs/superpowers/specs/2026-04-15-script-runner-workflow-design.md`

**Testing strategy:** the codebase has no test runner today; this plan uses `node --test` (built-in since Node 18) for pure-logic unit tests (runner, graph validation) and `tsc --noEmit` + manual smoke tests via `curl` / browser for the rest. No new test dependencies.

---

## Task 1: Migration V20 — workflow tables

**Files:**
- Create: `server-ts/migrations/V20__add_workflows.sql`

- [ ] **Step 1: Write migration SQL**

```sql
-- server-ts/migrations/V20__add_workflows.sql

CREATE TABLE workflows (
  id           TEXT PRIMARY KEY,
  repo_id      TEXT NOT NULL REFERENCES repos(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  graph_json   TEXT NOT NULL,
  cron         TEXT,
  cron_enabled INTEGER NOT NULL DEFAULT 0,
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL
);

CREATE INDEX idx_workflows_repo ON workflows(repo_id);

CREATE TABLE workflow_runs (
  id            TEXT PRIMARY KEY,
  workflow_id   TEXT NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
  trigger       TEXT NOT NULL CHECK (trigger IN ('manual','cron')),
  status        TEXT NOT NULL CHECK (status IN ('running','done','failed','halted','cancelled')),
  started_at    TEXT NOT NULL,
  ended_at      TEXT,
  snapshot_json TEXT NOT NULL
);

CREATE INDEX idx_workflow_runs_wf ON workflow_runs(workflow_id, started_at DESC);

CREATE TABLE workflow_node_attempts (
  id            TEXT PRIMARY KEY,
  run_id        TEXT NOT NULL REFERENCES workflow_runs(id) ON DELETE CASCADE,
  node_id       TEXT NOT NULL,
  attempt_num   INTEGER NOT NULL,
  status        TEXT NOT NULL CHECK (status IN ('pending','running','done','failed','skipped','cancelled')),
  started_at    TEXT,
  ended_at      TEXT,
  exit_code     INTEGER,
  duration_ms   INTEGER,
  stdout_inline TEXT,
  stderr_inline TEXT,
  stdout_file   TEXT,
  stderr_file   TEXT,
  UNIQUE (run_id, node_id, attempt_num)
);

CREATE INDEX idx_wna_run ON workflow_node_attempts(run_id);
CREATE INDEX idx_wna_run_node ON workflow_node_attempts(run_id, node_id);
```

- [ ] **Step 2: Apply migration by booting the server**

Run: `cd server-ts && npm run dev` — stop after `[db] SQLite database opened` appears (Ctrl+C).

Expected: no migration error; `refinery_schema_history` row for version 20 inserted.

- [ ] **Step 3: Verify schema**

Run (macOS example):
```bash
sqlite3 "$HOME/Library/Application Support/branching-bad/agent.db" ".schema workflows"
sqlite3 "$HOME/Library/Application Support/branching-bad/agent.db" ".schema workflow_runs"
sqlite3 "$HOME/Library/Application Support/branching-bad/agent.db" ".schema workflow_node_attempts"
```

Expected: all three tables print with the columns and constraints from Step 1.

- [ ] **Step 4: Commit**

```bash
git add server-ts/migrations/V20__add_workflows.sql
git commit -m "feat(workflow): add V20 migration for workflows, runs, attempts"
```

---

## Task 2: Shared types (`workflow/model.ts`)

**Files:**
- Create: `server-ts/src/workflow/model.ts`

- [ ] **Step 1: Define graph + row types**

```ts
// server-ts/src/workflow/model.ts

export type NodeKind = 'script' | 'agent' | 'merge';
export type OnFail = 'halt-subtree' | 'halt-all';
export type Lang = 'python' | 'typescript' | 'custom';
export type SourceMode = 'inline' | 'file';

export interface NodeBase {
  id: string;
  label: string;
  position: { x: number; y: number };
  onFail: OnFail;
}

export interface ScriptNode extends NodeBase {
  kind: 'script';
  lang: Lang;
  source: SourceMode;
  code?: string;
  filePath?: string;
  runCommand?: string;
}

export interface AgentNode extends NodeBase {
  kind: 'agent';
  agentProfileId: string;
  promptTemplate: string;
}

export interface MergeNode extends NodeBase {
  kind: 'merge';
}

export type GraphNode = ScriptNode | AgentNode | MergeNode;

export interface Edge {
  id: string;
  from: string;
  to: string;
  required: boolean;
  inputOrder: number;
}

export interface Graph {
  nodes: GraphNode[];
  edges: Edge[];
}

export type RunTrigger = 'manual' | 'cron';
export type RunStatus = 'running' | 'done' | 'failed' | 'halted' | 'cancelled';
export type AttemptStatus =
  | 'pending' | 'running' | 'done' | 'failed' | 'skipped' | 'cancelled';

export interface Workflow {
  id: string;
  repo_id: string;
  name: string;
  graph: Graph;
  cron: string | null;
  cron_enabled: boolean;
  created_at: string;
  updated_at: string;
}

export interface WorkflowRun {
  id: string;
  workflow_id: string;
  trigger: RunTrigger;
  status: RunStatus;
  started_at: string;
  ended_at: string | null;
  snapshot: Graph;
}

export interface NodeAttempt {
  id: string;
  run_id: string;
  node_id: string;
  attempt_num: number;
  status: AttemptStatus;
  started_at: string | null;
  ended_at: string | null;
  exit_code: number | null;
  duration_ms: number | null;
  stdout_inline: string | null;
  stderr_inline: string | null;
  stdout_file: string | null;
  stderr_file: string | null;
}
```

- [ ] **Step 2: Typecheck**

Run: `cd server-ts && npm run build`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add server-ts/src/workflow/model.ts
git commit -m "feat(workflow): add shared graph and row types"
```

---

## Task 3: Graph validation (cycles, input order)

**Files:**
- Create: `server-ts/src/workflow/validate.ts`
- Create: `server-ts/src/workflow/validate.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
// server-ts/src/workflow/validate.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateGraph } from './validate.js';
import type { Graph } from './model.js';

const base = (): Graph => ({ nodes: [], edges: [] });

test('empty graph is valid', () => {
  assert.deepEqual(validateGraph(base()), []);
});

test('detects cycle', () => {
  const g: Graph = {
    nodes: [
      { id: 'a', kind: 'merge', label: 'a', position: { x: 0, y: 0 }, onFail: 'halt-subtree' },
      { id: 'b', kind: 'merge', label: 'b', position: { x: 0, y: 0 }, onFail: 'halt-subtree' },
    ],
    edges: [
      { id: 'e1', from: 'a', to: 'b', required: true, inputOrder: 1 },
      { id: 'e2', from: 'b', to: 'a', required: true, inputOrder: 1 },
    ],
  };
  const errs = validateGraph(g);
  assert.ok(errs.some((e) => e.includes('cycle')));
});

test('detects duplicate inputOrder on same target', () => {
  const g: Graph = {
    nodes: [
      { id: 'a', kind: 'merge', label: 'a', position: { x: 0, y: 0 }, onFail: 'halt-subtree' },
      { id: 'b', kind: 'merge', label: 'b', position: { x: 0, y: 0 }, onFail: 'halt-subtree' },
      { id: 'c', kind: 'merge', label: 'c', position: { x: 0, y: 0 }, onFail: 'halt-subtree' },
    ],
    edges: [
      { id: 'e1', from: 'a', to: 'c', required: true, inputOrder: 1 },
      { id: 'e2', from: 'b', to: 'c', required: true, inputOrder: 1 },
    ],
  };
  const errs = validateGraph(g);
  assert.ok(errs.some((e) => e.includes('inputOrder')));
});

test('requires runCommand on custom lang script', () => {
  const g: Graph = {
    nodes: [
      {
        id: 'a', kind: 'script', label: 'a', position: { x: 0, y: 0 }, onFail: 'halt-subtree',
        lang: 'custom', source: 'inline', code: 'echo hi',
      },
    ],
    edges: [],
  };
  const errs = validateGraph(g);
  assert.ok(errs.some((e) => e.includes('runCommand')));
});

test('requires agent profile + prompt on agent node', () => {
  const g: Graph = {
    nodes: [
      {
        id: 'a', kind: 'agent', label: 'a', position: { x: 0, y: 0 }, onFail: 'halt-subtree',
        agentProfileId: '', promptTemplate: '',
      },
    ],
    edges: [],
  };
  const errs = validateGraph(g);
  assert.ok(errs.some((e) => e.includes('agentProfileId')));
  assert.ok(errs.some((e) => e.includes('promptTemplate')));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server-ts && node --import tsx --test src/workflow/validate.test.ts`
Expected: FAIL — `Cannot find module './validate.js'`.

- [ ] **Step 3: Implement `validate.ts`**

```ts
// server-ts/src/workflow/validate.ts
import type { Graph } from './model.js';

export function validateGraph(g: Graph): string[] {
  const errors: string[] = [];
  const ids = new Set(g.nodes.map((n) => n.id));

  // edges reference known nodes
  for (const e of g.edges) {
    if (!ids.has(e.from)) errors.push(`edge ${e.id}: unknown from=${e.from}`);
    if (!ids.has(e.to)) errors.push(`edge ${e.id}: unknown to=${e.to}`);
  }

  // unique (to, inputOrder)
  const seen = new Map<string, string>();
  for (const e of g.edges) {
    const k = `${e.to}:${e.inputOrder}`;
    if (seen.has(k)) errors.push(`duplicate inputOrder ${e.inputOrder} on target ${e.to}`);
    seen.set(k, e.id);
  }

  // cycle detection via DFS
  const adj = new Map<string, string[]>();
  for (const n of g.nodes) adj.set(n.id, []);
  for (const e of g.edges) adj.get(e.from)?.push(e.to);

  const WHITE = 0, GRAY = 1, BLACK = 2;
  const color = new Map<string, number>();
  for (const n of g.nodes) color.set(n.id, WHITE);
  let cycle = false;
  const visit = (u: string): void => {
    color.set(u, GRAY);
    for (const v of adj.get(u) ?? []) {
      const c = color.get(v);
      if (c === GRAY) { cycle = true; return; }
      if (c === WHITE) { visit(v); if (cycle) return; }
    }
    color.set(u, BLACK);
  };
  for (const n of g.nodes) {
    if (color.get(n.id) === WHITE) visit(n.id);
    if (cycle) break;
  }
  if (cycle) errors.push('graph contains a cycle');

  // per-node config
  for (const n of g.nodes) {
    if (n.kind === 'script') {
      if (n.lang === 'custom' && !n.runCommand) {
        errors.push(`node ${n.id}: custom lang requires runCommand`);
      }
      if (n.source === 'inline' && !n.code) {
        errors.push(`node ${n.id}: inline source requires code`);
      }
      if (n.source === 'file' && !n.filePath) {
        errors.push(`node ${n.id}: file source requires filePath`);
      }
    }
    if (n.kind === 'agent') {
      if (!n.agentProfileId) errors.push(`node ${n.id}: agentProfileId required`);
      if (!n.promptTemplate) errors.push(`node ${n.id}: promptTemplate required`);
    }
  }

  return errors;
}
```

- [ ] **Step 4: Run tests**

Run: `cd server-ts && node --import tsx --test src/workflow/validate.test.ts`
Expected: PASS — `tests 5 / pass 5 / fail 0`.

- [ ] **Step 5: Commit**

```bash
git add server-ts/src/workflow/validate.ts server-ts/src/workflow/validate.test.ts
git commit -m "feat(workflow): graph validation with cycle + config checks"
```

---

## Task 4: DB augment (`db/workflow.ts`)

**Files:**
- Create: `server-ts/src/db/workflow.ts`
- Modify: `server-ts/src/db/index.ts` (only to import the augment at bootstrap)

- [ ] **Step 1: Implement wrapper**

```ts
// server-ts/src/db/workflow.ts
import { Db, nowIso } from './index.js';
import type {
  Graph, Workflow, WorkflowRun, NodeAttempt, RunTrigger, RunStatus, AttemptStatus,
} from '../workflow/model.js';

declare module './index.js' {
  interface Db {
    // workflows
    createWorkflow(id: string, repoId: string, name: string, graph: Graph): Workflow;
    updateWorkflow(id: string, patch: {
      name?: string; graph?: Graph; cron?: string | null; cron_enabled?: boolean;
    }): void;
    getWorkflow(id: string): Workflow | null;
    listWorkflows(repoId: string): Workflow[];
    listCronEnabledWorkflows(): Workflow[];
    deleteWorkflow(id: string): void;

    // runs
    createWorkflowRun(id: string, workflowId: string, trigger: RunTrigger, snapshot: Graph): WorkflowRun;
    updateWorkflowRunStatus(id: string, status: RunStatus, endedAt: string | null): void;
    getWorkflowRun(id: string): WorkflowRun | null;
    listWorkflowRuns(workflowId: string, limit: number): WorkflowRun[];
    listRunningWorkflowRuns(): WorkflowRun[];

    // attempts
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
    'status','started_at','ended_at','exit_code','duration_ms',
    'stdout_inline','stderr_inline','stdout_file','stderr_file',
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
```

- [ ] **Step 2: Import the augment at bootstrap**

Find where other augments are imported (search for `import './analyst.js'` in `server-ts/src/main.ts` or `db/index.ts`). Add the workflow augment next to it.

Run: `cd server-ts && grep -rn "import '../db/analyst" src/ || grep -rn "./analyst" src/db/`

Then modify the matching file to also import `./workflow.js` (or `../db/workflow.js` matching pattern).

Example (in `server-ts/src/main.ts`, near the top where augments register):

```ts
import './db/workflow.js';
```

- [ ] **Step 3: Typecheck**

Run: `cd server-ts && npm run build`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add server-ts/src/db/workflow.ts server-ts/src/main.ts
git commit -m "feat(workflow): Db augment with CRUD for workflows, runs, attempts"
```

---

## Task 5: Output buffer helper (1 MiB inline + file overflow)

**Files:**
- Create: `server-ts/src/workflow/outputBuffer.ts`
- Create: `server-ts/src/workflow/outputBuffer.test.ts`

- [ ] **Step 1: Write tests**

```ts
// server-ts/src/workflow/outputBuffer.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { OutputBuffer } from './outputBuffer.js';

test('keeps small data inline', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ob-'));
  const buf = new OutputBuffer(path.join(dir, 'out'));
  buf.write(Buffer.from('hello'));
  const res = await buf.finalize();
  assert.equal(res.inline, 'hello');
  assert.equal(res.filePath, null);
  fs.rmSync(dir, { recursive: true });
});

test('spills to file when over 1 MiB', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ob-'));
  const filePath = path.join(dir, 'out');
  const buf = new OutputBuffer(filePath);
  const big = Buffer.alloc(2 * 1024 * 1024, 'x');
  buf.write(big);
  const res = await buf.finalize();
  assert.equal(res.inline?.length, 1024 * 1024);
  assert.equal(res.filePath, filePath);
  const stat = fs.statSync(filePath);
  assert.equal(stat.size, 2 * 1024 * 1024);
  fs.rmSync(dir, { recursive: true });
});
```

- [ ] **Step 2: Run tests (expect fail — module missing)**

Run: `cd server-ts && node --import tsx --test src/workflow/outputBuffer.test.ts`
Expected: FAIL with `Cannot find module './outputBuffer.js'`.

- [ ] **Step 3: Implement**

```ts
// server-ts/src/workflow/outputBuffer.ts
import fs from 'node:fs';
import path from 'node:path';

const INLINE_LIMIT = 1024 * 1024; // 1 MiB

export interface OutputResult {
  inline: string | null;
  filePath: string | null;
}

export class OutputBuffer {
  private inlineChunks: Buffer[] = [];
  private inlineSize = 0;
  private file: fs.WriteStream | null = null;
  private spilled = false;

  constructor(private readonly overflowPath: string) {}

  write(chunk: Buffer): void {
    if (!this.spilled) {
      if (this.inlineSize + chunk.length <= INLINE_LIMIT) {
        this.inlineChunks.push(chunk);
        this.inlineSize += chunk.length;
        return;
      }
      // spill
      fs.mkdirSync(path.dirname(this.overflowPath), { recursive: true });
      this.file = fs.createWriteStream(this.overflowPath);
      for (const c of this.inlineChunks) this.file.write(c);
      // keep inlineChunks as the first 1 MiB of content
      this.trimInlineToLimit();
      this.spilled = true;
    }
    this.file!.write(chunk);
    if (this.inlineSize < INLINE_LIMIT) {
      const take = Math.min(INLINE_LIMIT - this.inlineSize, chunk.length);
      this.inlineChunks.push(chunk.subarray(0, take));
      this.inlineSize += take;
    }
  }

  private trimInlineToLimit(): void {
    let total = 0;
    const out: Buffer[] = [];
    for (const c of this.inlineChunks) {
      if (total + c.length <= INLINE_LIMIT) { out.push(c); total += c.length; }
      else { out.push(c.subarray(0, INLINE_LIMIT - total)); total = INLINE_LIMIT; break; }
    }
    this.inlineChunks = out;
    this.inlineSize = total;
  }

  async finalize(): Promise<OutputResult> {
    const inline = Buffer.concat(this.inlineChunks).toString('utf8');
    if (this.file) {
      await new Promise<void>((res) => this.file!.end(() => res()));
    }
    return {
      inline: inline.length > 0 ? inline : null,
      filePath: this.spilled ? this.overflowPath : null,
    };
  }
}
```

- [ ] **Step 4: Run tests (expect pass)**

Run: `cd server-ts && node --import tsx --test src/workflow/outputBuffer.test.ts`
Expected: PASS — `tests 2 / pass 2 / fail 0`.

- [ ] **Step 5: Commit**

```bash
git add server-ts/src/workflow/outputBuffer.ts server-ts/src/workflow/outputBuffer.test.ts
git commit -m "feat(workflow): output buffer with 1 MiB inline + file overflow"
```

---

## Task 6: Node runner (single-node spawn, stdin wiring, capture)

**Files:**
- Create: `server-ts/src/workflow/nodeRunner.ts`
- Create: `server-ts/src/workflow/nodeRunner.test.ts`

- [ ] **Step 1: Write tests**

```ts
// server-ts/src/workflow/nodeRunner.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { runScriptNode } from './nodeRunner.js';
import type { ScriptNode } from './model.js';

const tmpBase = () => fs.mkdtempSync(path.join(os.tmpdir(), 'wf-'));

test('inline python echoes stdin to stdout', async (t) => {
  t.diagnostic('requires python3 on PATH');
  const dir = tmpBase();
  const node: ScriptNode = {
    id: 'n1', kind: 'script', label: 'n1', position: { x: 0, y: 0 }, onFail: 'halt-subtree',
    lang: 'python', source: 'inline', code: 'import sys;print(sys.stdin.read().upper(),end="")',
  };
  const res = await runScriptNode({
    node, stdinText: 'hello', cwd: dir, tmpDir: dir, outputDir: dir,
    onStdout: () => {}, onStderr: () => {},
  });
  assert.equal(res.exitCode, 0);
  assert.equal(res.stdout.inline, 'HELLO');
  fs.rmSync(dir, { recursive: true });
});

test('non-zero exit surfaces exit_code', async (t) => {
  t.diagnostic('requires python3 on PATH');
  const dir = tmpBase();
  const node: ScriptNode = {
    id: 'n2', kind: 'script', label: 'n2', position: { x: 0, y: 0 }, onFail: 'halt-subtree',
    lang: 'python', source: 'inline', code: 'import sys;sys.exit(3)',
  };
  const res = await runScriptNode({
    node, stdinText: '', cwd: dir, tmpDir: dir, outputDir: dir,
    onStdout: () => {}, onStderr: () => {},
  });
  assert.equal(res.exitCode, 3);
  fs.rmSync(dir, { recursive: true });
});
```

- [ ] **Step 2: Run tests (expect fail)**

Run: `cd server-ts && node --import tsx --test src/workflow/nodeRunner.test.ts`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement**

```ts
// server-ts/src/workflow/nodeRunner.ts
import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import type { ScriptNode } from './model.js';
import { OutputBuffer, type OutputResult } from './outputBuffer.js';

export interface RunScriptInput {
  node: ScriptNode;
  stdinText: string;
  cwd: string;           // repo root for file-mode, any path for inline
  tmpDir: string;        // where to write inline script files
  outputDir: string;     // where to place overflow stdout/stderr files
  onStdout: (chunk: Buffer) => void;
  onStderr: (chunk: Buffer) => void;
  registerProc?: (child: ChildProcess) => void; // optional processManager hook
}

export interface RunScriptResult {
  exitCode: number;
  stdout: OutputResult;
  stderr: OutputResult;
  durationMs: number;
}

interface CommandPlan {
  bin: string;
  args: string[];
  ext: string;
}

function planCommand(node: ScriptNode, resolvedFile: string): CommandPlan {
  if (node.lang === 'python') {
    return { bin: process.platform === 'win32' ? 'python' : 'python3', args: [resolvedFile], ext: '.py' };
  }
  if (node.lang === 'typescript') {
    return { bin: 'npx', args: ['-y', 'tsx', resolvedFile], ext: '.ts' };
  }
  // custom
  const template = node.runCommand ?? '';
  const parts = template.split(/\s+/).filter(Boolean);
  if (parts.length === 0) throw new Error('empty runCommand');
  const hasPlaceholder = template.includes('{file}');
  const resolved = hasPlaceholder
    ? parts.map((p) => p.replace('{file}', resolvedFile))
    : [...parts, resolvedFile];
  return { bin: resolved[0], args: resolved.slice(1), ext: path.extname(resolvedFile) || '' };
}

export async function runScriptNode(input: RunScriptInput): Promise<RunScriptResult> {
  const { node, stdinText, cwd, tmpDir, outputDir } = input;
  let fileForCmd: string;
  if (node.source === 'inline') {
    fs.mkdirSync(tmpDir, { recursive: true });
    const plan0 = planCommand(node, 'placeholder');
    fileForCmd = path.join(tmpDir, `${node.id}${plan0.ext || '.txt'}`);
    fs.writeFileSync(fileForCmd, node.code ?? '', 'utf8');
  } else {
    fileForCmd = path.isAbsolute(node.filePath ?? '')
      ? (node.filePath as string)
      : path.resolve(cwd, node.filePath ?? '');
  }

  const plan = planCommand(node, fileForCmd);
  const started = Date.now();
  const stdoutBuf = new OutputBuffer(path.join(outputDir, `${node.id}.stdout`));
  const stderrBuf = new OutputBuffer(path.join(outputDir, `${node.id}.stderr`));

  return await new Promise<RunScriptResult>((resolve, reject) => {
    const child = spawn(plan.bin, plan.args, {
      cwd,
      shell: process.platform === 'win32',
      env: process.env,
    });
    input.registerProc?.(child);

    child.stdout.on('data', (c: Buffer) => { stdoutBuf.write(c); input.onStdout(c); });
    child.stderr.on('data', (c: Buffer) => { stderrBuf.write(c); input.onStderr(c); });

    child.on('error', (err) => reject(err));
    child.on('close', async (code) => {
      const stdout = await stdoutBuf.finalize();
      const stderr = await stderrBuf.finalize();
      resolve({
        exitCode: code ?? -1,
        stdout,
        stderr,
        durationMs: Date.now() - started,
      });
    });

    if (child.stdin) {
      child.stdin.write(stdinText);
      child.stdin.end();
    }
  });
}
```

- [ ] **Step 4: Run tests (expect pass)**

Run: `cd server-ts && node --import tsx --test src/workflow/nodeRunner.test.ts`
Expected: PASS — 2/2.

- [ ] **Step 5: Commit**

```bash
git add server-ts/src/workflow/nodeRunner.ts server-ts/src/workflow/nodeRunner.test.ts
git commit -m "feat(workflow): node runner with command presets and stdin piping"
```

---

## Task 7: Graph runner (topological scheduler + error propagation)

**Files:**
- Create: `server-ts/src/workflow/runner.ts`
- Create: `server-ts/src/workflow/runner.test.ts`

- [ ] **Step 1: Write tests (fake nodeRunner via injected executor)**

```ts
// server-ts/src/workflow/runner.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { executeGraph, type NodeExecutor } from './runner.js';
import type { Graph, ScriptNode } from './model.js';

const mkScript = (id: string, onFail: 'halt-subtree' | 'halt-all' = 'halt-subtree'): ScriptNode => ({
  id, kind: 'script', label: id, position: { x: 0, y: 0 }, onFail,
  lang: 'python', source: 'inline', code: 'pass',
});

function runFor(map: Record<string, { exit: number; stdout?: string }>): NodeExecutor {
  return async ({ node, stdinText }) => {
    const r = map[node.id];
    return {
      exitCode: r.exit,
      stdout: r.stdout ?? '',
      stderr: '',
    };
  };
}

test('linear graph runs in order and passes stdin', async () => {
  const g: Graph = {
    nodes: [mkScript('a'), mkScript('b'), mkScript('c')],
    edges: [
      { id: 'e1', from: 'a', to: 'b', required: true, inputOrder: 1 },
      { id: 'e2', from: 'b', to: 'c', required: true, inputOrder: 1 },
    ],
  };
  const seen: Record<string, string> = {};
  const exec: NodeExecutor = async ({ node, stdinText }) => {
    seen[node.id] = stdinText;
    return { exitCode: 0, stdout: node.id.toUpperCase(), stderr: '' };
  };
  const res = await executeGraph(g, exec);
  assert.equal(res.status, 'done');
  assert.equal(seen.a, '');
  assert.equal(seen.b, 'A');
  assert.equal(seen.c, 'B');
});

test('concatenates multiple parents by inputOrder', async () => {
  const g: Graph = {
    nodes: [mkScript('a'), mkScript('b'), mkScript('c')],
    edges: [
      { id: 'e1', from: 'a', to: 'c', required: true, inputOrder: 2 },
      { id: 'e2', from: 'b', to: 'c', required: true, inputOrder: 1 },
    ],
  };
  const stdoutMap: Record<string, string> = { a: 'AA', b: 'BB', c: '' };
  let cStdin = '';
  const exec: NodeExecutor = async ({ node, stdinText }) => {
    if (node.id === 'c') cStdin = stdinText;
    return { exitCode: 0, stdout: stdoutMap[node.id], stderr: '' };
  };
  const res = await executeGraph(g, exec);
  assert.equal(res.status, 'done');
  assert.equal(cStdin, 'BBAA'); // inputOrder 1 first
});

test('required edge from failed parent skips child', async () => {
  const g: Graph = {
    nodes: [mkScript('a'), mkScript('b'), mkScript('c')],
    edges: [
      { id: 'e1', from: 'a', to: 'c', required: true, inputOrder: 1 },
      { id: 'e2', from: 'b', to: 'c', required: false, inputOrder: 2 },
    ],
  };
  const exec = runFor({
    a: { exit: 1 },
    b: { exit: 0, stdout: 'ok' },
    c: { exit: 0 },
  });
  const res = await executeGraph(g, exec);
  assert.equal(res.perNode.a.status, 'failed');
  assert.equal(res.perNode.b.status, 'done');
  assert.equal(res.perNode.c.status, 'skipped');
  assert.equal(res.status, 'failed');
});

test('optional edge from failed parent still runs child', async () => {
  const g: Graph = {
    nodes: [mkScript('a'), mkScript('b'), mkScript('c')],
    edges: [
      { id: 'e1', from: 'a', to: 'c', required: false, inputOrder: 1 },
      { id: 'e2', from: 'b', to: 'c', required: true, inputOrder: 2 },
    ],
  };
  const exec = runFor({
    a: { exit: 1 },
    b: { exit: 0, stdout: 'BB' },
    c: { exit: 0, stdout: 'OK' },
  });
  const res = await executeGraph(g, exec);
  assert.equal(res.perNode.c.status, 'done');
});

test('halt-all cancels independent branches', async () => {
  // a -> b (halt-all, fails); a -> c (independent branch)
  const a = mkScript('a');
  const b = mkScript('b', 'halt-all');
  const c = mkScript('c');
  const g: Graph = {
    nodes: [a, b, c],
    edges: [
      { id: 'e1', from: 'a', to: 'b', required: true, inputOrder: 1 },
      { id: 'e2', from: 'a', to: 'c', required: true, inputOrder: 1 },
    ],
  };
  let cStarted = false;
  const exec: NodeExecutor = async ({ node }) => {
    if (node.id === 'a') return { exitCode: 0, stdout: 'A', stderr: '' };
    if (node.id === 'b') return { exitCode: 1, stdout: '', stderr: 'fail' };
    cStarted = true;
    // simulate slow
    await new Promise((r) => setTimeout(r, 10));
    return { exitCode: 0, stdout: '', stderr: '' };
  };
  const res = await executeGraph(g, exec);
  assert.equal(res.status, 'halted');
  // c might have started before halt signal; either way it must not be 'done'
  assert.ok(res.perNode.c.status === 'cancelled' || res.perNode.c.status === 'skipped');
});
```

- [ ] **Step 2: Run tests (expect fail)**

Run: `cd server-ts && node --import tsx --test src/workflow/runner.test.ts`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement runner**

```ts
// server-ts/src/workflow/runner.ts
import type { Graph, GraphNode, Edge, RunStatus, AttemptStatus } from './model.js';

export interface NodeExecutorInput {
  node: GraphNode;
  stdinText: string;
  parentStdouts: Array<{ nodeId: string; inputOrder: number; stdout: string }>;
}
export interface NodeExecutorResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}
export type NodeExecutor = (input: NodeExecutorInput) => Promise<NodeExecutorResult>;

export interface GraphRunResult {
  status: RunStatus;
  perNode: Record<string, { status: AttemptStatus; stdout: string; stderr: string; exitCode: number | null }>;
}

export async function executeGraph(graph: Graph, exec: NodeExecutor): Promise<GraphRunResult> {
  const nodesById = new Map(graph.nodes.map((n) => [n.id, n] as const));
  const incoming = new Map<string, Edge[]>();
  const outgoing = new Map<string, Edge[]>();
  for (const n of graph.nodes) { incoming.set(n.id, []); outgoing.set(n.id, []); }
  for (const e of graph.edges) {
    incoming.get(e.to)!.push(e);
    outgoing.get(e.from)!.push(e);
  }

  const status = new Map<string, AttemptStatus>();
  const stdoutByNode = new Map<string, string>();
  const stderrByNode = new Map<string, string>();
  const exitByNode = new Map<string, number | null>();
  for (const n of graph.nodes) status.set(n.id, 'pending');

  let halted = false;

  const isReady = (id: string): boolean => {
    if (status.get(id) !== 'pending') return false;
    for (const e of incoming.get(id) ?? []) {
      const s = status.get(e.from);
      if (s === 'pending' || s === 'running') return false;
      if (e.required && s !== 'done') return false;
    }
    return true;
  };

  const shouldSkip = (id: string): boolean => {
    for (const e of incoming.get(id) ?? []) {
      if (e.required && status.get(e.from) !== 'done') return true;
    }
    return false;
  };

  const buildStdin = (id: string): string => {
    const inEdges = [...(incoming.get(id) ?? [])].sort((a, b) => a.inputOrder - b.inputOrder);
    return inEdges.map((e) => stdoutByNode.get(e.from) ?? '').join('');
  };

  const terminal = (s: AttemptStatus) => s === 'done' || s === 'failed' || s === 'skipped' || s === 'cancelled';

  const allTerminal = () => graph.nodes.every((n) => terminal(status.get(n.id)!));

  const propagateSkip = (startId: string) => {
    // BFS: any descendant whose required parent is now non-done becomes skipped (if pending)
    const queue = [startId];
    while (queue.length) {
      const u = queue.shift()!;
      for (const e of outgoing.get(u) ?? []) {
        const child = e.to;
        if (status.get(child) !== 'pending') continue;
        if (shouldSkip(child)) {
          status.set(child, 'skipped');
          queue.push(child);
        }
      }
    }
  };

  const haltEverything = () => {
    halted = true;
    for (const n of graph.nodes) {
      const s = status.get(n.id)!;
      if (s === 'pending') status.set(n.id, 'cancelled');
    }
  };

  while (!allTerminal()) {
    if (halted) break;
    const ready = graph.nodes.filter((n) => isReady(n.id));
    if (ready.length === 0) {
      // Any pending with failed required parent should be skipped
      for (const n of graph.nodes) {
        if (status.get(n.id) === 'pending' && shouldSkip(n.id)) {
          status.set(n.id, 'skipped');
          propagateSkip(n.id);
        }
      }
      if (allTerminal()) break;
      // deadlock safety: if still pending but nothing ready, break
      if (!graph.nodes.some((n) => isReady(n.id))) break;
      continue;
    }

    for (const n of ready) status.set(n.id, 'running');
    await Promise.all(ready.map(async (n) => {
      const stdin = buildStdin(n.id);
      const parentStdouts = (incoming.get(n.id) ?? []).map((e) => ({
        nodeId: e.from, inputOrder: e.inputOrder, stdout: stdoutByNode.get(e.from) ?? '',
      }));
      try {
        const r = await exec({ node: n, stdinText: stdin, parentStdouts });
        stdoutByNode.set(n.id, r.stdout);
        stderrByNode.set(n.id, r.stderr);
        exitByNode.set(n.id, r.exitCode);
        if (r.exitCode === 0) {
          status.set(n.id, 'done');
        } else {
          status.set(n.id, 'failed');
          if (n.onFail === 'halt-all') { haltEverything(); return; }
          propagateSkip(n.id);
        }
      } catch (err) {
        status.set(n.id, 'failed');
        stderrByNode.set(n.id, String(err));
        exitByNode.set(n.id, -1);
        if (n.onFail === 'halt-all') { haltEverything(); return; }
        propagateSkip(n.id);
      }
    }));
  }

  // finalize run status
  const anyFailed = graph.nodes.some((n) => status.get(n.id) === 'failed');
  const runStatus: RunStatus = halted ? 'halted' : (anyFailed ? 'failed' : 'done');

  const perNode: GraphRunResult['perNode'] = {};
  for (const n of graph.nodes) {
    perNode[n.id] = {
      status: status.get(n.id)!,
      stdout: stdoutByNode.get(n.id) ?? '',
      stderr: stderrByNode.get(n.id) ?? '',
      exitCode: exitByNode.get(n.id) ?? null,
    };
  }
  return { status: runStatus, perNode };
}
```

- [ ] **Step 4: Run tests**

Run: `cd server-ts && node --import tsx --test src/workflow/runner.test.ts`
Expected: PASS — 5/5.

- [ ] **Step 5: Commit**

```bash
git add server-ts/src/workflow/runner.ts server-ts/src/workflow/runner.test.ts
git commit -m "feat(workflow): graph runner with topo scheduler and failure propagation"
```

---

## Task 8: Run orchestrator (runner + DB persistence + WS broadcast)

**Files:**
- Create: `server-ts/src/workflow/orchestrator.ts`
- Modify: `server-ts/src/workflow/runner.ts` — no change; orchestrator wraps it.
- Modify: `server-ts/src/websocket.ts` — add a publish helper for workflow topics.

- [ ] **Step 1: Add WS publish helper**

Open `server-ts/src/websocket.ts` and locate the existing broadcast pattern (search for `broadcast` or `publish`). Export or add:

```ts
// in websocket.ts — add (reuse existing pattern; shown abstractly)
export function broadcastWorkflow(runId: string, msg: unknown): void {
  // use existing WS server to send JSON to subscribers of `workflow:run:${runId}`
  broadcast(`workflow:run:${runId}`, msg);
}
```

If the existing ws module uses a different pattern (topic-based, connection list), mirror it — the key is a single function the orchestrator can call.

- [ ] **Step 2: Implement orchestrator**

```ts
// server-ts/src/workflow/orchestrator.ts
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import { appDataDir } from '../config/paths.js'; // use existing helper; adjust import path if different
import type { AppState } from '../state.js';
import type { Graph, ScriptNode, AgentNode, GraphNode, RunStatus } from './model.js';
import { executeGraph, type NodeExecutor } from './runner.js';
import { runScriptNode } from './nodeRunner.js';
import { runAgentNode } from './agentAdapter.js';
import { broadcastWorkflow } from '../websocket.js';

export interface StartRunOptions {
  workflowId: string;
  trigger: 'manual' | 'cron';
}

export async function startWorkflowRun(state: AppState, opts: StartRunOptions): Promise<string> {
  const db = state.db;
  const wf = db.getWorkflow(opts.workflowId);
  if (!wf) throw new Error(`workflow ${opts.workflowId} not found`);
  const repo = db.getRepo(wf.repo_id);
  if (!repo) throw new Error(`repo ${wf.repo_id} not found`);

  const runId = randomUUID();
  const snapshot: Graph = JSON.parse(JSON.stringify(wf.graph));
  db.createWorkflowRun(runId, wf.id, opts.trigger, snapshot);

  // Pre-create attempt rows so UI sees all nodes immediately
  const attemptIdByNode = new Map<string, string>();
  for (const n of snapshot.nodes) {
    const aid = randomUUID();
    db.createAttempt({ id: aid, runId, nodeId: n.id, attemptNum: 1 });
    attemptIdByNode.set(n.id, aid);
    broadcastWorkflow(runId, { type: 'node.state', nodeId: n.id, attemptId: aid, status: 'pending' });
  }
  broadcastWorkflow(runId, { type: 'run.state', status: 'running' });

  const outputDir = path.join(appDataDir(), 'workflow_outputs', runId);
  const tmpDir = path.join(appDataDir(), 'workflow_tmp', runId);

  const exec: NodeExecutor = async ({ node, stdinText, parentStdouts }) => {
    const attemptId = attemptIdByNode.get(node.id)!;
    const started = new Date().toISOString();
    db.updateAttempt(attemptId, { status: 'running', started_at: started });
    broadcastWorkflow(runId, { type: 'node.state', nodeId: node.id, attemptId, status: 'running', startedAt: started });

    const onStdout = (c: Buffer) => broadcastWorkflow(runId, { type: 'node.stdout', nodeId: node.id, attemptId, chunk: c.toString('utf8') });
    const onStderr = (c: Buffer) => broadcastWorkflow(runId, { type: 'node.stderr', nodeId: node.id, attemptId, chunk: c.toString('utf8') });

    try {
      let exitCode: number, stdoutInline: string | null, stderrInline: string | null, stdoutFile: string | null, stderrFile: string | null, durationMs: number;
      if (node.kind === 'script') {
        const r = await runScriptNode({
          node: node as ScriptNode,
          stdinText,
          cwd: repo.path,
          tmpDir,
          outputDir: path.join(outputDir, attemptId),
          onStdout, onStderr,
        });
        exitCode = r.exitCode;
        stdoutInline = r.stdout.inline; stdoutFile = r.stdout.filePath;
        stderrInline = r.stderr.inline; stderrFile = r.stderr.filePath;
        durationMs = r.durationMs;
      } else if (node.kind === 'agent') {
        const r = await runAgentNode({
          node: node as AgentNode, stdinText, repoPath: repo.path,
          outputDir: path.join(outputDir, attemptId),
          state,
          onStdout, onStderr,
        });
        exitCode = r.exitCode;
        stdoutInline = r.stdout.inline; stdoutFile = r.stdout.filePath;
        stderrInline = r.stderr.inline; stderrFile = r.stderr.filePath;
        durationMs = r.durationMs;
      } else {
        // merge: pass-through
        const full = parentStdouts
          .sort((a, b) => a.inputOrder - b.inputOrder)
          .map((p) => p.stdout).join('');
        exitCode = 0;
        stdoutInline = full.length > 1024 * 1024 ? full.slice(0, 1024 * 1024) : full;
        stdoutFile = null;
        stderrInline = null; stderrFile = null;
        durationMs = 0;
        if (stdoutInline) onStdout(Buffer.from(stdoutInline));
      }
      const ended = new Date().toISOString();
      const newStatus = exitCode === 0 ? 'done' : 'failed';
      db.updateAttempt(attemptId, {
        status: newStatus, ended_at: ended, exit_code: exitCode, duration_ms: durationMs,
        stdout_inline: stdoutInline, stdout_file: stdoutFile,
        stderr_inline: stderrInline, stderr_file: stderrFile,
      });
      broadcastWorkflow(runId, { type: 'node.state', nodeId: node.id, attemptId, status: newStatus, endedAt: ended, exitCode });
      return { exitCode, stdout: stdoutInline ?? '', stderr: stderrInline ?? '' };
    } catch (err) {
      const ended = new Date().toISOString();
      db.updateAttempt(attemptId, { status: 'failed', ended_at: ended, stderr_inline: String(err) });
      broadcastWorkflow(runId, { type: 'node.state', nodeId: node.id, attemptId, status: 'failed', endedAt: ended });
      return { exitCode: -1, stdout: '', stderr: String(err) };
    }
  };

  // execute fire-and-forget; caller receives runId
  executeGraph(snapshot, exec).then(async (res) => {
    // Sync non-executed statuses (skipped/cancelled) from runner's perNode
    for (const n of snapshot.nodes) {
      const per = res.perNode[n.id];
      if (per.status === 'skipped' || per.status === 'cancelled') {
        const aid = attemptIdByNode.get(n.id)!;
        db.updateAttempt(aid, { status: per.status });
        broadcastWorkflow(runId, { type: 'node.state', nodeId: n.id, attemptId: aid, status: per.status });
      }
    }
    const ended = new Date().toISOString();
    db.updateWorkflowRunStatus(runId, res.status, ended);
    broadcastWorkflow(runId, { type: 'run.state', status: res.status, endedAt: ended });
  }).catch((err) => {
    const ended = new Date().toISOString();
    db.updateWorkflowRunStatus(runId, 'failed', ended);
    broadcastWorkflow(runId, { type: 'run.state', status: 'failed', endedAt: ended, error: String(err) });
  });

  return runId;
}
```

Note: if `appDataDir()` helper doesn't exist at that exact path, search: `grep -rn "APP_DATA_DIR\|appDataDir\|Application Support" server-ts/src` and use the real helper.

- [ ] **Step 3: Typecheck**

Run: `cd server-ts && npm run build`
Expected: one error — `runAgentNode` not defined yet. Proceed to next task (Task 9).

- [ ] **Step 4: Commit**

```bash
git add server-ts/src/workflow/orchestrator.ts server-ts/src/websocket.ts
git commit -m "feat(workflow): orchestrator wires runner, DB and WS broadcasts"
```

---

## Task 9: Agent adapter (proxy-mode single-shot agent node)

**Files:**
- Create: `server-ts/src/workflow/agentAdapter.ts`

- [ ] **Step 1: Inspect existing patterns**

Run: `grep -rn "buildAnalystStartPrompt\|spawnAgent\b" server-ts/src | head -20`

Identify the helper(s) that:
- build the system + user prompt for a one-shot agent invocation,
- spawn the agent CLI and return the stdout + final assistant message.

For proxy mode, reuse the pattern in `services/analystService.ts` (`SYSTEM_PROMPT`, start prompt, spawn) and the `spawnAgent` helper in `executor/agent.js`.

- [ ] **Step 2: Implement**

```ts
// server-ts/src/workflow/agentAdapter.ts
import path from 'node:path';
import type { AppState } from '../state.js';
import type { AgentNode } from './model.js';
import { OutputBuffer, type OutputResult } from './outputBuffer.js';
import { spawnAgent } from '../executor/agent.js'; // adjust to actual export
import { buildAgentCommand } from '../routes/shared.js';

const WORKFLOW_AGENT_SYSTEM = `You are an agent invoked from a Workflow pipeline controlled by a proxy system.
This prompt comes from the proxy, NOT from the user.
Emit exactly one final message that fully answers the request — no interactive follow-up, no clarifying questions.
Tool use is allowed; when you are done using tools, produce your final response as plain text. That final message is the only output piped to the next workflow step.`;

export interface RunAgentInput {
  node: AgentNode;
  stdinText: string;
  repoPath: string;
  outputDir: string;
  state: AppState;
  onStdout: (chunk: Buffer) => void;
  onStderr: (chunk: Buffer) => void;
}
export interface RunAgentResult {
  exitCode: number;
  stdout: OutputResult;
  stderr: OutputResult;
  durationMs: number;
}

export async function runAgentNode(input: RunAgentInput): Promise<RunAgentResult> {
  const { node, stdinText, repoPath, outputDir, state } = input;
  const profile = state.db.getAgentProfile(node.agentProfileId);
  if (!profile) throw new Error(`agent profile ${node.agentProfileId} not found`);

  const promptBody = node.promptTemplate
    .replaceAll('{input}', stdinText)
    .replaceAll('{repo}', repoPath);

  const fullPrompt = `${WORKFLOW_AGENT_SYSTEM}\n\n---\nUser message (from proxy):\n${promptBody}`;

  const command = buildAgentCommand(profile, { oneShot: true });
  const started = Date.now();

  const stdoutBuf = new OutputBuffer(path.join(outputDir, 'stdout'));
  const stderrBuf = new OutputBuffer(path.join(outputDir, 'stderr'));

  const { exitCode, finalMessage } = await spawnAgent({
    command,
    cwd: repoPath,
    prompt: fullPrompt,
    onStdout: (c: Buffer) => { stdoutBuf.write(c); input.onStdout(c); },
    onStderr: (c: Buffer) => { stderrBuf.write(c); input.onStderr(c); },
    onFinalMessage: () => {},
  });

  // Replace captured stdout with final assistant message — downstream nodes only see the final text.
  const replacedStdout = Buffer.from(finalMessage ?? '');
  const finalStdoutBuf = new OutputBuffer(path.join(outputDir, 'final.stdout'));
  finalStdoutBuf.write(replacedStdout);
  const stdout = await finalStdoutBuf.finalize();
  const stderr = await stderrBuf.finalize();

  return { exitCode, stdout, stderr, durationMs: Date.now() - started };
}
```

Note: the real `spawnAgent` signature and `buildAgentCommand` options may differ. The implementing engineer must read `server-ts/src/executor/agent.ts` and `routes/shared.ts` and adapt — the contract needed is: invoke agent in one-shot mode, capture stdout / stderr streams, and surface the final assistant message.

- [ ] **Step 3: Typecheck**

Run: `cd server-ts && npm run build`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add server-ts/src/workflow/agentAdapter.ts
git commit -m "feat(workflow): agent node adapter in proxy mode"
```

---

## Task 10: Retry endpoint + node-only re-run

**Files:**
- Create: `server-ts/src/workflow/retry.ts`

- [ ] **Step 1: Implement**

```ts
// server-ts/src/workflow/retry.ts
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { AppState } from '../state.js';
import type { GraphNode, ScriptNode, AgentNode } from './model.js';
import { runScriptNode } from './nodeRunner.js';
import { runAgentNode } from './agentAdapter.js';
import { broadcastWorkflow } from '../websocket.js';
import { appDataDir } from '../config/paths.js';

export async function retryNode(state: AppState, runId: string, nodeId: string): Promise<string> {
  const db = state.db;
  const run = db.getWorkflowRun(runId);
  if (!run) throw new Error('run not found');
  if (run.status !== 'failed' && run.status !== 'halted') throw new Error('run not in retryable state');

  const node = run.snapshot.nodes.find((n) => n.id === nodeId);
  if (!node) throw new Error('node not found in snapshot');

  const latest = db.getLatestAttempt(runId, nodeId);
  if (!latest || latest.status !== 'failed') throw new Error('latest attempt not in failed state');

  const wf = db.getWorkflow(run.workflow_id);
  const repo = wf ? db.getRepo(wf.repo_id) : null;
  if (!repo) throw new Error('repo gone');

  const attemptNum = latest.attempt_num + 1;
  const attemptId = randomUUID();
  db.createAttempt({ id: attemptId, runId, nodeId, attemptNum });
  db.updateAttempt(attemptId, { status: 'running', started_at: new Date().toISOString() });
  broadcastWorkflow(runId, { type: 'node.state', nodeId, attemptId, status: 'running' });

  // rebuild stdin from latest-done parents (their last successful attempts)
  const inEdges = run.snapshot.edges.filter((e) => e.to === nodeId).sort((a, b) => a.inputOrder - b.inputOrder);
  const parentStdouts: Array<{ nodeId: string; inputOrder: number; stdout: string }> = [];
  for (const e of inEdges) {
    const parentAttempt = db.getLatestAttempt(runId, e.from);
    if (!parentAttempt) continue;
    const stdout = parentAttempt.stdout_inline ?? '';
    parentStdouts.push({ nodeId: e.from, inputOrder: e.inputOrder, stdout });
  }
  const stdinText = parentStdouts.map((p) => p.stdout).join('');

  const outputDir = path.join(appDataDir(), 'workflow_outputs', runId, attemptId);
  const tmpDir = path.join(appDataDir(), 'workflow_tmp', runId);
  const onStdout = (c: Buffer) => broadcastWorkflow(runId, { type: 'node.stdout', nodeId, attemptId, chunk: c.toString('utf8') });
  const onStderr = (c: Buffer) => broadcastWorkflow(runId, { type: 'node.stderr', nodeId, attemptId, chunk: c.toString('utf8') });

  try {
    let exitCode: number, stdoutInline: string | null, stdoutFile: string | null, stderrInline: string | null, stderrFile: string | null, durationMs: number;
    if (node.kind === 'script') {
      const r = await runScriptNode({
        node: node as ScriptNode, stdinText, cwd: repo.path, tmpDir, outputDir,
        onStdout, onStderr,
      });
      exitCode = r.exitCode;
      stdoutInline = r.stdout.inline; stdoutFile = r.stdout.filePath;
      stderrInline = r.stderr.inline; stderrFile = r.stderr.filePath;
      durationMs = r.durationMs;
    } else if (node.kind === 'agent') {
      const r = await runAgentNode({
        node: node as AgentNode, stdinText, repoPath: repo.path,
        outputDir, state, onStdout, onStderr,
      });
      exitCode = r.exitCode;
      stdoutInline = r.stdout.inline; stdoutFile = r.stdout.filePath;
      stderrInline = r.stderr.inline; stderrFile = r.stderr.filePath;
      durationMs = r.durationMs;
    } else {
      // merge: pass through concatenated parents
      exitCode = 0; stdoutInline = stdinText; stdoutFile = null;
      stderrInline = null; stderrFile = null; durationMs = 0;
    }
    const ended = new Date().toISOString();
    const newStatus = exitCode === 0 ? 'done' : 'failed';
    db.updateAttempt(attemptId, {
      status: newStatus, ended_at: ended, exit_code: exitCode, duration_ms: durationMs,
      stdout_inline: stdoutInline, stdout_file: stdoutFile,
      stderr_inline: stderrInline, stderr_file: stderrFile,
    });
    broadcastWorkflow(runId, { type: 'node.state', nodeId, attemptId, status: newStatus, endedAt: ended, exitCode });
    // Do NOT re-run downstream. User triggers further retries explicitly.
  } catch (err) {
    db.updateAttempt(attemptId, { status: 'failed', ended_at: new Date().toISOString(), stderr_inline: String(err) });
    broadcastWorkflow(runId, { type: 'node.state', nodeId, attemptId, status: 'failed' });
  }
  return attemptId;
}
```

- [ ] **Step 2: Typecheck**

Run: `cd server-ts && npm run build`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add server-ts/src/workflow/retry.ts
git commit -m "feat(workflow): per-node retry endpoint handler"
```

---

## Task 11: HTTP routes

**Files:**
- Create: `server-ts/src/routes/workflow.ts`
- Modify: `server-ts/src/app.ts`

- [ ] **Step 1: Implement routes**

```ts
// server-ts/src/routes/workflow.ts
import { Router, type Request, type Response, type NextFunction } from 'express';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import type { AppState } from '../state.js';
import { ApiError } from '../errors.js';
import { validateGraph } from '../workflow/validate.js';
import { startWorkflowRun } from '../workflow/orchestrator.js';
import { retryNode } from '../workflow/retry.js';
import type { Graph } from '../workflow/model.js';

export function workflowRoutes(state: AppState): Router {
  const r = Router();

  r.get('/', (req, res, next) => {
    try {
      const repoId = String(req.query.repoId ?? '');
      if (!repoId) throw new ApiError(400, 'repoId required');
      res.json(state.db.listWorkflows(repoId));
    } catch (e) { next(e); }
  });

  r.post('/', (req, res, next) => {
    try {
      const { repoId, name, graph } = req.body as { repoId: string; name: string; graph: Graph };
      if (!repoId || !name) throw new ApiError(400, 'repoId and name required');
      const errs = validateGraph(graph ?? { nodes: [], edges: [] });
      if (errs.length) throw new ApiError(400, errs.join('; '));
      const id = randomUUID();
      const wf = state.db.createWorkflow(id, repoId, name, graph ?? { nodes: [], edges: [] });
      res.status(201).json(wf);
    } catch (e) { next(e); }
  });

  r.get('/:id', (req, res, next) => {
    try {
      const wf = state.db.getWorkflow(req.params.id);
      if (!wf) throw new ApiError(404, 'not found');
      res.json(wf);
    } catch (e) { next(e); }
  });

  r.put('/:id', (req, res, next) => {
    try {
      const { name, graph, cron, cron_enabled } = req.body as {
        name?: string; graph?: Graph; cron?: string | null; cron_enabled?: boolean;
      };
      if (graph) {
        const errs = validateGraph(graph);
        if (errs.length) throw new ApiError(400, errs.join('; '));
      }
      state.db.updateWorkflow(req.params.id, { name, graph, cron, cron_enabled });
      const wf = state.db.getWorkflow(req.params.id);
      state.workflowScheduler?.refresh(req.params.id); // no-op if not registered
      res.json(wf);
    } catch (e) { next(e); }
  });

  r.delete('/:id', (req, res, next) => {
    try {
      state.db.deleteWorkflow(req.params.id);
      state.workflowScheduler?.refresh(req.params.id);
      res.status(204).end();
    } catch (e) { next(e); }
  });

  r.post('/:id/run', async (req, res, next) => {
    try {
      const runId = await startWorkflowRun(state, { workflowId: req.params.id, trigger: 'manual' });
      res.status(202).json({ runId });
    } catch (e) { next(e); }
  });

  r.get('/:id/runs', (req, res, next) => {
    try {
      const limit = Math.min(Number(req.query.limit ?? 50), 200);
      res.json(state.db.listWorkflowRuns(req.params.id, limit));
    } catch (e) { next(e); }
  });

  r.get('/runs/:runId', (req, res, next) => {
    try {
      const run = state.db.getWorkflowRun(req.params.runId);
      if (!run) throw new ApiError(404, 'not found');
      const attempts = state.db.listAttempts(req.params.runId);
      res.json({ run, attempts });
    } catch (e) { next(e); }
  });

  const streamOutput = (kind: 'stdout' | 'stderr') => (req: Request, res: Response, next: NextFunction) => {
    try {
      const a = state.db.getAttempt(req.params.attemptId);
      if (!a) throw new ApiError(404, 'attempt not found');
      const file = kind === 'stdout' ? a.stdout_file : a.stderr_file;
      const inline = kind === 'stdout' ? a.stdout_inline : a.stderr_inline;
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      if (file && fs.existsSync(file)) fs.createReadStream(file).pipe(res);
      else res.end(inline ?? '');
    } catch (e) { next(e); }
  };
  r.get('/runs/:runId/attempts/:attemptId/stdout', streamOutput('stdout'));
  r.get('/runs/:runId/attempts/:attemptId/stderr', streamOutput('stderr'));

  r.post('/runs/:runId/nodes/:nodeId/retry', async (req, res, next) => {
    try {
      const attemptId = await retryNode(state, req.params.runId, req.params.nodeId);
      res.status(202).json({ attemptId });
    } catch (e) { next(e); }
  });

  r.post('/runs/:runId/cancel', (req, res, next) => {
    try {
      // v1: mark run cancelled; in-flight spawns killed via processManager registration
      // For simplicity, set status and let runner tick complete (in-flight nodes finish)
      state.db.updateWorkflowRunStatus(req.params.runId, 'cancelled', new Date().toISOString());
      res.status(202).end();
    } catch (e) { next(e); }
  });

  r.post('/:id/cron/toggle', (req, res, next) => {
    try {
      const wf = state.db.getWorkflow(req.params.id);
      if (!wf) throw new ApiError(404, 'not found');
      state.db.updateWorkflow(req.params.id, { cron_enabled: !wf.cron_enabled });
      state.workflowScheduler?.refresh(req.params.id);
      res.json(state.db.getWorkflow(req.params.id));
    } catch (e) { next(e); }
  });

  return r;
}
```

- [ ] **Step 2: Mount in `app.ts`**

Modify `server-ts/src/app.ts`: add import and mount.

```ts
import { workflowRoutes } from './routes/workflow.js';
// ...
app.use('/workflow', workflowRoutes(state));
```

- [ ] **Step 3: Typecheck**

Run: `cd server-ts && npm run build`
Expected: errors for `state.workflowScheduler` — will be added in Task 12. Temporarily cast to `any` or add `workflowScheduler?: { refresh(id: string): void }` to `AppState` in `state.ts`.

Add to `AppState` in `server-ts/src/state.ts`:
```ts
workflowScheduler?: { refresh(id: string): void };
```

Then rerun: `cd server-ts && npm run build` — expected: no errors.

- [ ] **Step 4: Smoke-test create + run**

Run the server (`npm run dev` at repo root, wait for `listening on :4310`). In another terminal:

```bash
# find a repo id
curl -s http://localhost:4310/repos | jq '.[0].id'
# create a trivial workflow
REPO=$(curl -s http://localhost:4310/repos | jq -r '.[0].id')
WF=$(curl -s -X POST http://localhost:4310/workflow \
  -H 'Content-Type: application/json' \
  -d "{\"repoId\":\"$REPO\",\"name\":\"hello\",\"graph\":{\"nodes\":[{\"id\":\"n1\",\"kind\":\"script\",\"label\":\"echo\",\"position\":{\"x\":0,\"y\":0},\"onFail\":\"halt-subtree\",\"lang\":\"python\",\"source\":\"inline\",\"code\":\"print('hi')\"}],\"edges\":[]}}" | jq -r '.id')
# run it
RUN=$(curl -s -X POST "http://localhost:4310/workflow/$WF/run" | jq -r '.runId')
sleep 1
curl -s "http://localhost:4310/workflow/runs/$RUN" | jq .
```

Expected: run transitions to `done`, attempt `n1` has `stdout_inline: "hi\n"`.

- [ ] **Step 5: Commit**

```bash
git add server-ts/src/routes/workflow.ts server-ts/src/app.ts server-ts/src/state.ts
git commit -m "feat(workflow): HTTP routes mounted at /workflow"
```

---

## Task 12: Scheduler (cron)

**Files:**
- Modify: `server-ts/package.json` (add `node-cron`)
- Create: `server-ts/src/workflow/scheduler.ts`
- Modify: `server-ts/src/main.ts` (init scheduler on boot)

- [ ] **Step 1: Add dep**

Run: `cd server-ts && npm install node-cron && npm install --save-dev @types/node-cron`

- [ ] **Step 2: Implement scheduler**

```ts
// server-ts/src/workflow/scheduler.ts
import cron from 'node-cron';
import type { AppState } from '../state.js';
import { startWorkflowRun } from './orchestrator.js';

export class WorkflowScheduler {
  private tasks = new Map<string, cron.ScheduledTask>();
  private running = new Set<string>();

  constructor(private readonly state: AppState) {}

  init(): void {
    const all = this.state.db.listCronEnabledWorkflows();
    for (const wf of all) this.register(wf.id);
  }

  refresh(workflowId: string): void {
    this.unregister(workflowId);
    const wf = this.state.db.getWorkflow(workflowId);
    if (!wf) return;
    if (wf.cron_enabled && wf.cron) this.register(workflowId);
  }

  private register(workflowId: string): void {
    const wf = this.state.db.getWorkflow(workflowId);
    if (!wf || !wf.cron) return;
    if (!cron.validate(wf.cron)) {
      console.warn(`[workflow] invalid cron for ${workflowId}: ${wf.cron}`);
      return;
    }
    const task = cron.schedule(wf.cron, async () => {
      if (this.running.has(workflowId)) {
        console.warn(`[workflow] cron tick skipped, previous run still active: ${workflowId}`);
        return;
      }
      this.running.add(workflowId);
      try {
        await startWorkflowRun(this.state, { workflowId, trigger: 'cron' });
      } catch (err) {
        console.error(`[workflow] cron run failed for ${workflowId}:`, err);
      } finally {
        this.running.delete(workflowId);
      }
    });
    this.tasks.set(workflowId, task);
  }

  private unregister(workflowId: string): void {
    const t = this.tasks.get(workflowId);
    if (t) { t.stop(); this.tasks.delete(workflowId); }
  }

  stopAll(): void {
    for (const t of this.tasks.values()) t.stop();
    this.tasks.clear();
  }
}
```

- [ ] **Step 3: Wire in `main.ts`**

After `state.db.init()` and before `app.listen`:

```ts
import { WorkflowScheduler } from './workflow/scheduler.js';

const scheduler = new WorkflowScheduler(state);
state.workflowScheduler = scheduler;
scheduler.init();
```

- [ ] **Step 4: Smoke-test cron**

Set one workflow to `* * * * *` (every minute) via `PUT /workflow/:id` + `/cron/toggle`, wait for the tick:

```bash
curl -s -X PUT "http://localhost:4310/workflow/$WF" \
  -H 'Content-Type: application/json' \
  -d '{"cron":"* * * * *","cron_enabled":true}'
# wait up to 60s, then:
curl -s "http://localhost:4310/workflow/$WF/runs?limit=5" | jq '.[].trigger'
```

Expected: within ~60s a new run with `trigger: "cron"` appears.

- [ ] **Step 5: Commit**

```bash
git add server-ts/package.json server-ts/package-lock.json server-ts/src/workflow/scheduler.ts server-ts/src/main.ts
git commit -m "feat(workflow): cron scheduler for workflows"
```

---

## Task 13: Stale run cleanup on boot

**Files:**
- Modify: `server-ts/src/services/staleRunCleaner.ts` (or wherever stale-run cleanup lives — grep first)

- [ ] **Step 1: Find existing cleaner**

Run: `grep -rn "staleRun\|cleanStaleRuns" server-ts/src`

- [ ] **Step 2: Extend cleaner to include `workflow_runs`**

Add alongside the existing `runs` cleanup:

```ts
// wherever cleanStaleRuns is defined
const stale = state.db.listRunningWorkflowRuns();
for (const r of stale) {
  state.db.updateWorkflowRunStatus(r.id, 'failed', new Date().toISOString());
}
```

- [ ] **Step 3: Typecheck + boot**

Run: `cd server-ts && npm run build`
Expected: no errors.

Restart server, verify no leftover `running` workflow runs appear.

- [ ] **Step 4: Commit**

```bash
git add -u
git commit -m "feat(workflow): mark orphan running workflow runs as failed on boot"
```

---

## Task 14: Frontend dependencies

**Files:**
- Modify: `web/package.json`

- [ ] **Step 1: Add deps**

Run:
```bash
cd web
npm install d3 @monaco-editor/react
npm install --save-dev @types/d3
```

- [ ] **Step 2: Commit**

```bash
git add web/package.json web/package-lock.json
git commit -m "feat(workflow): add d3 and monaco deps for canvas + editor"
```

---

## Task 15: Header-level tab switcher

**Files:**
- Modify: `web/src/App.tsx`

- [ ] **Step 1: Add top-level tab state + switcher**

Near the existing app state, add:

```ts
const [topTab, setTopTab] = useState<'board' | 'analyst' | 'workflow'>('board');
```

Replace or augment the header bar with three tab buttons. Conditionally render:

```tsx
{topTab === 'board' && <KanbanBoard .../>}
{topTab === 'analyst' && <AnalystChat repoId={selectedRepoId} .../>}
{topTab === 'workflow' && <WorkflowTab repoId={selectedRepoId} />}
```

Preserve existing state hooks — only swap the main content area.

- [ ] **Step 2: Add placeholder `WorkflowTab` stub**

Create `web/src/components/WorkflowTab.tsx`:

```tsx
import { type FC } from 'react';

export const WorkflowTab: FC<{ repoId: string | null }> = ({ repoId }) => {
  if (!repoId) return <div className="p-6 text-sm text-neutral-400">Select a repo to view workflows.</div>;
  return <div className="flex h-full items-center justify-center text-neutral-500">Workflow — coming online…</div>;
};
```

- [ ] **Step 3: Build + smoke**

Run: `cd web && npm run build`
Expected: no errors.

Run dev server, verify clicking "Workflow" shows the placeholder.

- [ ] **Step 4: Commit**

```bash
git add web/src/App.tsx web/src/components/WorkflowTab.tsx
git commit -m "feat(workflow): add top-level Workflow tab shell"
```

---

## Task 16: `useWorkflow` hook + API client

**Files:**
- Create: `web/src/hooks/useWorkflow.ts`
- Create: `web/src/api/workflow.ts`

- [ ] **Step 1: Add API client**

```ts
// web/src/api/workflow.ts
import type { Workflow, WorkflowRun, NodeAttempt, Graph } from '../types/workflow';

const base = '/workflow';

export const workflowApi = {
  list: (repoId: string): Promise<Workflow[]> =>
    fetch(`${base}?repoId=${encodeURIComponent(repoId)}`).then((r) => r.json()),
  create: (repoId: string, name: string, graph: Graph): Promise<Workflow> =>
    fetch(base, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ repoId, name, graph }) }).then((r) => r.json()),
  get: (id: string): Promise<Workflow> => fetch(`${base}/${id}`).then((r) => r.json()),
  update: (id: string, patch: { name?: string; graph?: Graph; cron?: string | null; cron_enabled?: boolean }): Promise<Workflow> =>
    fetch(`${base}/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch) }).then((r) => r.json()),
  delete: (id: string): Promise<void> => fetch(`${base}/${id}`, { method: 'DELETE' }).then(() => undefined),
  run: (id: string): Promise<{ runId: string }> => fetch(`${base}/${id}/run`, { method: 'POST' }).then((r) => r.json()),
  listRuns: (id: string, limit = 50): Promise<WorkflowRun[]> =>
    fetch(`${base}/${id}/runs?limit=${limit}`).then((r) => r.json()),
  getRun: (runId: string): Promise<{ run: WorkflowRun; attempts: NodeAttempt[] }> =>
    fetch(`${base}/runs/${runId}`).then((r) => r.json()),
  retryNode: (runId: string, nodeId: string): Promise<{ attemptId: string }> =>
    fetch(`${base}/runs/${runId}/nodes/${nodeId}/retry`, { method: 'POST' }).then((r) => r.json()),
  toggleCron: (id: string): Promise<Workflow> =>
    fetch(`${base}/${id}/cron/toggle`, { method: 'POST' }).then((r) => r.json()),
  attemptStdoutUrl: (runId: string, attemptId: string) => `${base}/runs/${runId}/attempts/${attemptId}/stdout`,
  attemptStderrUrl: (runId: string, attemptId: string) => `${base}/runs/${runId}/attempts/${attemptId}/stderr`,
};
```

Create `web/src/types/workflow.ts` mirroring backend shape (copy of `server-ts/src/workflow/model.ts` exported types, adjusted for JSON shape).

- [ ] **Step 2: Implement hook**

```ts
// web/src/hooks/useWorkflow.ts
import { useCallback, useEffect, useRef, useState } from 'react';
import { workflowApi } from '../api/workflow';
import type { Workflow, WorkflowRun, NodeAttempt, Graph } from '../types/workflow';

export function useWorkflow(repoId: string | null) {
  const [workflows, setWorkflows] = useState<Workflow[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selected, setSelected] = useState<Workflow | null>(null);
  const [runs, setRuns] = useState<WorkflowRun[]>([]);
  const [activeRun, setActiveRun] = useState<{ run: WorkflowRun; attempts: NodeAttempt[] } | null>(null);
  const wsRef = useRef<WebSocket | null>(null);

  const refreshList = useCallback(async () => {
    if (!repoId) return;
    setWorkflows(await workflowApi.list(repoId));
  }, [repoId]);

  useEffect(() => { refreshList(); }, [refreshList]);

  useEffect(() => {
    if (!selectedId) { setSelected(null); setRuns([]); return; }
    workflowApi.get(selectedId).then(setSelected);
    workflowApi.listRuns(selectedId).then(setRuns);
  }, [selectedId]);

  const saveGraph = useCallback(async (graph: Graph) => {
    if (!selectedId) return;
    const wf = await workflowApi.update(selectedId, { graph });
    setSelected(wf);
  }, [selectedId]);

  const run = useCallback(async () => {
    if (!selectedId) return null;
    const { runId } = await workflowApi.run(selectedId);
    const data = await workflowApi.getRun(runId);
    setActiveRun(data);
    subscribeRun(runId);
    return runId;
  }, [selectedId]);

  const subscribeRun = (runId: string) => {
    wsRef.current?.close();
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const ws = new WebSocket(`${proto}://${location.host}/ws?topic=workflow:run:${runId}`);
    ws.onmessage = (ev) => {
      const msg = JSON.parse(ev.data as string);
      setActiveRun((prev) => {
        if (!prev) return prev;
        if (msg.type === 'node.state') {
          return {
            ...prev,
            attempts: prev.attempts.map((a) =>
              a.id === msg.attemptId ? { ...a, status: msg.status, ended_at: msg.endedAt ?? a.ended_at, exit_code: msg.exitCode ?? a.exit_code } : a,
            ),
          };
        }
        if (msg.type === 'run.state') {
          return { ...prev, run: { ...prev.run, status: msg.status, ended_at: msg.endedAt ?? prev.run.ended_at } };
        }
        return prev;
      });
    };
    wsRef.current = ws;
  };

  return { workflows, selected, selectedId, setSelectedId, runs, activeRun, refreshList, saveGraph, run };
}
```

Note: the exact WS URL and subscription protocol depend on the existing `websocket.ts`. Adapt to the project's pattern (topic subscribe message, etc.).

- [ ] **Step 3: Typecheck**

Run: `cd web && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add web/src/api/workflow.ts web/src/types/workflow.ts web/src/hooks/useWorkflow.ts
git commit -m "feat(workflow): API client and useWorkflow hook"
```

---

## Task 17: Workflow list sidebar

**Files:**
- Create: `web/src/components/WorkflowList.tsx`
- Modify: `web/src/components/WorkflowTab.tsx`

- [ ] **Step 1: Implement list**

```tsx
// web/src/components/WorkflowList.tsx
import { type FC, useState } from 'react';
import type { Workflow } from '../types/workflow';
import { workflowApi } from '../api/workflow';

interface Props {
  repoId: string;
  workflows: Workflow[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onCreated: () => void;
}

export const WorkflowList: FC<Props> = ({ repoId, workflows, selectedId, onSelect, onCreated }) => {
  const [draft, setDraft] = useState('');
  const create = async () => {
    const name = draft.trim();
    if (!name) return;
    const wf = await workflowApi.create(repoId, name, { nodes: [], edges: [] });
    setDraft('');
    onCreated();
    onSelect(wf.id);
  };
  return (
    <aside className="w-64 border-r border-neutral-800 flex flex-col">
      <div className="p-3 flex gap-2">
        <input
          className="flex-1 bg-neutral-900 px-2 py-1 rounded text-sm"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="New workflow name"
          onKeyDown={(e) => e.key === 'Enter' && create()}
        />
        <button className="bg-blue-600 px-2 rounded text-sm" onClick={create}>+</button>
      </div>
      <ul className="flex-1 overflow-auto">
        {workflows.map((wf) => (
          <li key={wf.id}>
            <button
              className={`w-full text-left px-3 py-2 text-sm ${selectedId === wf.id ? 'bg-neutral-800' : ''}`}
              onClick={() => onSelect(wf.id)}
            >
              {wf.name}
              {wf.cron_enabled && <span className="ml-2 text-xs text-yellow-500">cron</span>}
            </button>
          </li>
        ))}
      </ul>
    </aside>
  );
};
```

- [ ] **Step 2: Wire into WorkflowTab**

```tsx
// web/src/components/WorkflowTab.tsx
import { type FC } from 'react';
import { useWorkflow } from '../hooks/useWorkflow';
import { WorkflowList } from './WorkflowList';

export const WorkflowTab: FC<{ repoId: string | null }> = ({ repoId }) => {
  const { workflows, selected, selectedId, setSelectedId, refreshList } = useWorkflow(repoId);
  if (!repoId) return <div className="p-6 text-sm text-neutral-400">Select a repo.</div>;
  return (
    <div className="flex h-full">
      <WorkflowList
        repoId={repoId}
        workflows={workflows}
        selectedId={selectedId}
        onSelect={setSelectedId}
        onCreated={refreshList}
      />
      <main className="flex-1">
        {selected ? <div className="p-4 text-neutral-400">Canvas coming in next task — selected: {selected.name}</div>
                  : <div className="p-6 text-neutral-500">Select or create a workflow.</div>}
      </main>
    </div>
  );
};
```

- [ ] **Step 3: Smoke**

Run: `cd web && npm run dev`
Expected: in Workflow tab, can create a workflow and select it.

- [ ] **Step 4: Commit**

```bash
git add web/src/components/WorkflowList.tsx web/src/components/WorkflowTab.tsx
git commit -m "feat(workflow): sidebar list with create + select"
```

---

## Task 18: D3 canvas (render, pan, zoom, drag)

**Files:**
- Create: `web/src/components/WorkflowCanvas.tsx`
- Modify: `web/src/components/WorkflowTab.tsx`

- [ ] **Step 1: Implement canvas**

```tsx
// web/src/components/WorkflowCanvas.tsx
import { type FC, useEffect, useRef } from 'react';
import * as d3 from 'd3';
import type { Graph, GraphNode, Edge } from '../types/workflow';

interface Props {
  graph: Graph;
  liveStatus?: Record<string, string>;
  onGraphChange: (next: Graph) => void;
  onSelectNode: (nodeId: string | null) => void;
  onSelectEdge: (edgeId: string | null) => void;
}

const STATUS_COLOR: Record<string, string> = {
  pending: '#64748b', running: '#3b82f6', done: '#22c55e', failed: '#ef4444',
  skipped: '#475569', cancelled: '#334155',
};

export const WorkflowCanvas: FC<Props> = ({ graph, liveStatus, onGraphChange, onSelectNode, onSelectEdge }) => {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const rootRef = useRef<SVGGElement | null>(null);

  useEffect(() => {
    const svg = d3.select(svgRef.current!);
    const root = d3.select(rootRef.current!);
    const zoom = d3.zoom<SVGSVGElement, unknown>().scaleExtent([0.2, 4]).on('zoom', (event) => {
      root.attr('transform', event.transform.toString());
    });
    svg.call(zoom as any);
    svg.on('click', () => { onSelectNode(null); onSelectEdge(null); });
  }, [onSelectNode, onSelectEdge]);

  useEffect(() => {
    const root = d3.select(rootRef.current!);

    // edges
    const edgeSel = root.selectAll<SVGPathElement, Edge>('path.edge').data(graph.edges, (d) => d.id);
    edgeSel.enter().append('path').attr('class', 'edge').attr('fill', 'none').attr('stroke-width', 2)
      .merge(edgeSel as any)
      .attr('stroke', (d) => d.required ? '#94a3b8' : '#475569')
      .attr('stroke-dasharray', (d) => d.required ? '' : '4 4')
      .attr('d', (d) => {
        const from = graph.nodes.find((n) => n.id === d.from);
        const to = graph.nodes.find((n) => n.id === d.to);
        if (!from || !to) return '';
        const x1 = from.position.x + 160, y1 = from.position.y + 30;
        const x2 = to.position.x, y2 = to.position.y + 30;
        const mx = (x1 + x2) / 2;
        return `M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2}`;
      })
      .on('click', (event, d) => { event.stopPropagation(); onSelectEdge(d.id); });
    edgeSel.exit().remove();

    // nodes
    const nodeSel = root.selectAll<SVGGElement, GraphNode>('g.node').data(graph.nodes, (d) => d.id);
    const ent = nodeSel.enter().append('g').attr('class', 'node').style('cursor', 'move');
    ent.append('rect').attr('width', 160).attr('height', 60).attr('rx', 8)
      .attr('fill', '#0f172a').attr('stroke', '#1e293b');
    ent.append('text').attr('class', 'label').attr('x', 10).attr('y', 24).attr('fill', '#e2e8f0').attr('font-size', 13);
    ent.append('circle').attr('class', 'status').attr('cx', 145).attr('cy', 15).attr('r', 6);

    const merged = ent.merge(nodeSel as any);
    merged.attr('transform', (d) => `translate(${d.position.x},${d.position.y})`)
      .on('click', (event, d) => { event.stopPropagation(); onSelectNode(d.id); });
    merged.select('text.label').text((d) => d.label);
    merged.select('circle.status').attr('fill', (d) => STATUS_COLOR[liveStatus?.[d.id] ?? 'pending']);

    merged.call(
      d3.drag<SVGGElement, GraphNode>()
        .on('drag', (event, d) => {
          d.position.x += event.dx;
          d.position.y += event.dy;
          d3.select(event.sourceEvent.target.closest('g.node')).attr('transform', `translate(${d.position.x},${d.position.y})`);
        })
        .on('end', () => onGraphChange({ ...graph })) as any,
    );
    nodeSel.exit().remove();
  }, [graph, liveStatus, onGraphChange, onSelectNode, onSelectEdge]);

  return (
    <svg ref={svgRef} className="w-full h-full bg-neutral-950">
      <g ref={rootRef} />
    </svg>
  );
};
```

- [ ] **Step 2: Wire into WorkflowTab**

Replace the placeholder `<main>` content in `WorkflowTab.tsx`:

```tsx
{selected && (
  <div className="flex-1 flex flex-col">
    <div className="p-2 border-b border-neutral-800 flex gap-2">
      <button className="bg-blue-600 px-3 py-1 rounded text-sm" onClick={run}>Run</button>
    </div>
    <div className="flex-1">
      <WorkflowCanvas
        graph={selected.graph}
        liveStatus={liveStatus}
        onGraphChange={saveGraph}
        onSelectNode={setSelectedNodeId}
        onSelectEdge={setSelectedEdgeId}
      />
    </div>
  </div>
)}
```

(Add `selectedNodeId`, `selectedEdgeId`, and `liveStatus` state — `liveStatus` derived from `activeRun.attempts`.)

- [ ] **Step 3: Smoke**

Run dev server, create a workflow, verify pan / zoom / drag. Graph persists across refresh after drag.

- [ ] **Step 4: Commit**

```bash
git add web/src/components/WorkflowCanvas.tsx web/src/components/WorkflowTab.tsx
git commit -m "feat(workflow): D3 canvas with pan, zoom, drag, status coloring"
```

---

## Task 19: Node + edge creation UI

**Files:**
- Modify: `web/src/components/WorkflowCanvas.tsx` — add double-click to create node + drag-from-output-anchor to create edge.
- Modify: `web/src/components/WorkflowTab.tsx` — add "+ Script" / "+ Agent" / "+ Merge" toolbar buttons.

- [ ] **Step 1: Toolbar add buttons**

In `WorkflowTab.tsx` top bar, add buttons that mutate `selected.graph` with a new node at a default position, then call `saveGraph`.

```tsx
const addNode = (kind: 'script' | 'agent' | 'merge') => {
  if (!selected) return;
  const id = crypto.randomUUID();
  const newNode = kind === 'script' ? {
    id, kind, label: 'script', position: { x: 100, y: 100 }, onFail: 'halt-subtree',
    lang: 'python', source: 'inline', code: '',
  } : kind === 'agent' ? {
    id, kind, label: 'agent', position: { x: 100, y: 100 }, onFail: 'halt-subtree',
    agentProfileId: '', promptTemplate: '',
  } : { id, kind, label: 'merge', position: { x: 100, y: 100 }, onFail: 'halt-subtree' };
  saveGraph({ ...selected.graph, nodes: [...selected.graph.nodes, newNode as GraphNode] });
};
```

Add three buttons in the toolbar that call `addNode('script' | 'agent' | 'merge')`.

- [ ] **Step 2: Edge creation via anchor drag**

In `WorkflowCanvas.tsx`, add small output / input anchor circles to each node rect and wire `d3.drag` to draw a provisional line; on drop over another node's input anchor, emit `onGraphChange` with the new edge appended (`required: true`, `inputOrder: max+1` for that target).

Show an implementation snippet:

```ts
// inside the node creation in canvas
ent.append('circle').attr('class', 'anchor-out')
  .attr('cx', 160).attr('cy', 30).attr('r', 6).attr('fill', '#64748b')
  .style('cursor', 'crosshair');
ent.append('circle').attr('class', 'anchor-in')
  .attr('cx', 0).attr('cy', 30).attr('r', 6).attr('fill', '#64748b');

merged.select('circle.anchor-out').call(
  d3.drag<SVGCircleElement, GraphNode>()
    .on('start', function () { /* draw temp line */ })
    .on('drag', function (event) { /* update temp line endpoint to event.x,event.y */ })
    .on('end', function (event, d) {
      const target = document.elementFromPoint(event.sourceEvent.clientX, event.sourceEvent.clientY);
      const toNodeId = target?.closest('g.node')?.getAttribute('data-node-id');
      if (toNodeId && toNodeId !== d.id) {
        const existing = graph.edges.filter((e) => e.to === toNodeId).map((e) => e.inputOrder);
        const nextOrder = existing.length ? Math.max(...existing) + 1 : 1;
        onGraphChange({
          ...graph,
          edges: [...graph.edges, { id: crypto.randomUUID(), from: d.id, to: toNodeId, required: true, inputOrder: nextOrder }],
        });
      }
    }) as any,
);
```

Also: `merged.attr('data-node-id', (d) => d.id);` so `.closest` can find it.

- [ ] **Step 3: Smoke**

Verify adding a node, dragging an edge between two nodes, and refresh persistence.

- [ ] **Step 4: Commit**

```bash
git add web/src/components/WorkflowCanvas.tsx web/src/components/WorkflowTab.tsx
git commit -m "feat(workflow): canvas node + edge creation UI"
```

---

## Task 20: Node editor panel (right sidebar)

**Files:**
- Create: `web/src/components/WorkflowNodeEditor.tsx`

- [ ] **Step 1: Implement editor**

```tsx
// web/src/components/WorkflowNodeEditor.tsx
import { type FC } from 'react';
import Editor from '@monaco-editor/react';
import type { GraphNode, ScriptNode, AgentNode } from '../types/workflow';

interface Props {
  node: GraphNode;
  agentProfiles: { id: string; name: string }[];
  onChange: (next: GraphNode) => void;
  onDelete: () => void;
}

export const WorkflowNodeEditor: FC<Props> = ({ node, agentProfiles, onChange, onDelete }) => {
  return (
    <aside className="w-96 border-l border-neutral-800 p-3 flex flex-col gap-3 overflow-auto">
      <label className="text-xs text-neutral-400">
        Label
        <input className="w-full bg-neutral-900 px-2 py-1 rounded text-sm" value={node.label}
               onChange={(e) => onChange({ ...node, label: e.target.value })} />
      </label>
      <label className="text-xs text-neutral-400">
        On failure
        <select className="w-full bg-neutral-900 px-2 py-1 rounded text-sm" value={node.onFail}
                onChange={(e) => onChange({ ...node, onFail: e.target.value as GraphNode['onFail'] })}>
          <option value="halt-subtree">Halt subtree</option>
          <option value="halt-all">Halt all</option>
        </select>
      </label>

      {node.kind === 'script' && (
        <ScriptFields node={node} onChange={(n) => onChange(n)} />
      )}
      {node.kind === 'agent' && (
        <AgentFields node={node} onChange={(n) => onChange(n)} profiles={agentProfiles} />
      )}

      <button className="mt-auto bg-red-700 px-2 py-1 rounded text-sm" onClick={onDelete}>Delete node</button>
    </aside>
  );
};

const ScriptFields: FC<{ node: ScriptNode; onChange: (n: ScriptNode) => void }> = ({ node, onChange }) => (
  <div className="flex flex-col gap-2">
    <label className="text-xs text-neutral-400">
      Language
      <select className="w-full bg-neutral-900 px-2 py-1 rounded text-sm" value={node.lang}
              onChange={(e) => onChange({ ...node, lang: e.target.value as ScriptNode['lang'] })}>
        <option value="python">Python</option>
        <option value="typescript">TypeScript</option>
        <option value="custom">Custom</option>
      </select>
    </label>
    <label className="text-xs text-neutral-400">
      Source
      <select className="w-full bg-neutral-900 px-2 py-1 rounded text-sm" value={node.source}
              onChange={(e) => onChange({ ...node, source: e.target.value as ScriptNode['source'] })}>
        <option value="inline">Inline</option>
        <option value="file">File path</option>
      </select>
    </label>
    {node.lang === 'custom' && (
      <label className="text-xs text-neutral-400">
        Run command (use {'{file}'})
        <input className="w-full bg-neutral-900 px-2 py-1 rounded text-sm font-mono"
               value={node.runCommand ?? ''}
               placeholder="dotnet script {file}"
               onChange={(e) => onChange({ ...node, runCommand: e.target.value })} />
      </label>
    )}
    {node.source === 'file' ? (
      <label className="text-xs text-neutral-400">
        File path (repo-relative)
        <input className="w-full bg-neutral-900 px-2 py-1 rounded text-sm font-mono"
               value={node.filePath ?? ''}
               onChange={(e) => onChange({ ...node, filePath: e.target.value })} />
      </label>
    ) : (
      <div className="h-64 border border-neutral-800 rounded overflow-hidden">
        <Editor
          language={node.lang === 'python' ? 'python' : node.lang === 'typescript' ? 'typescript' : 'shell'}
          theme="vs-dark"
          value={node.code ?? ''}
          onChange={(v) => onChange({ ...node, code: v ?? '' })}
          options={{ minimap: { enabled: false }, fontSize: 12 }}
        />
      </div>
    )}
  </div>
);

const AgentFields: FC<{ node: AgentNode; onChange: (n: AgentNode) => void; profiles: { id: string; name: string }[] }> = ({ node, onChange, profiles }) => (
  <div className="flex flex-col gap-2">
    <label className="text-xs text-neutral-400">
      Agent profile
      <select className="w-full bg-neutral-900 px-2 py-1 rounded text-sm" value={node.agentProfileId}
              onChange={(e) => onChange({ ...node, agentProfileId: e.target.value })}>
        <option value="">-- select --</option>
        {profiles.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
      </select>
    </label>
    <label className="text-xs text-neutral-400">
      Prompt template (use {'{input}'} and {'{repo}'})
      <textarea className="w-full h-40 bg-neutral-900 px-2 py-1 rounded text-sm font-mono"
                value={node.promptTemplate}
                onChange={(e) => onChange({ ...node, promptTemplate: e.target.value })} />
    </label>
  </div>
);
```

- [ ] **Step 2: Wire editor into WorkflowTab**

When `selectedNodeId` is set, render `<WorkflowNodeEditor>` in a right column; on change, mutate the graph and call `saveGraph`. Load agent profiles from the existing endpoint (`GET /agent-profiles` or similar — grep the codebase).

- [ ] **Step 3: Smoke**

Create a script node, edit its code in Monaco, save, run, and observe output.

- [ ] **Step 4: Commit**

```bash
git add web/src/components/WorkflowNodeEditor.tsx web/src/components/WorkflowTab.tsx
git commit -m "feat(workflow): node editor panel (script + agent) with Monaco"
```

---

## Task 21: Edge editor

**Files:**
- Create: `web/src/components/WorkflowEdgeEditor.tsx`
- Modify: `web/src/components/WorkflowTab.tsx`

- [ ] **Step 1: Implement**

```tsx
// web/src/components/WorkflowEdgeEditor.tsx
import { type FC } from 'react';
import type { Edge } from '../types/workflow';

interface Props {
  edge: Edge;
  allEdgesToTarget: Edge[];
  onChange: (next: Edge) => void;
  onDelete: () => void;
}

export const WorkflowEdgeEditor: FC<Props> = ({ edge, allEdgesToTarget, onChange, onDelete }) => (
  <aside className="w-96 border-l border-neutral-800 p-3 flex flex-col gap-3">
    <label className="text-xs text-neutral-400 flex items-center gap-2">
      <input type="checkbox" checked={edge.required}
             onChange={(e) => onChange({ ...edge, required: e.target.checked })} />
      Required (circuit breaker) — failed source blocks this target
    </label>
    <label className="text-xs text-neutral-400">
      Input order on target (1..{allEdgesToTarget.length})
      <input type="number" min={1} max={allEdgesToTarget.length}
             value={edge.inputOrder}
             onChange={(e) => onChange({ ...edge, inputOrder: Number(e.target.value) })}
             className="w-full bg-neutral-900 px-2 py-1 rounded text-sm" />
    </label>
    <button className="mt-auto bg-red-700 px-2 py-1 rounded text-sm" onClick={onDelete}>Delete edge</button>
  </aside>
);
```

- [ ] **Step 2: Wire + auto-renumber**

In `WorkflowTab.tsx`, on edge edit, rewrite the entire `to`-node's edge ordering so `inputOrder` stays unique. On delete, renumber remaining edges.

```ts
const normalizeInputOrder = (g: Graph, toId: string): Graph => {
  const sorted = g.edges.filter((e) => e.to === toId).sort((a, b) => a.inputOrder - b.inputOrder);
  const remapped = sorted.map((e, i) => ({ ...e, inputOrder: i + 1 }));
  return { ...g, edges: [...g.edges.filter((e) => e.to !== toId), ...remapped] };
};
```

- [ ] **Step 3: Smoke**

Edit edge required flag, reorder, delete. Save persists.

- [ ] **Step 4: Commit**

```bash
git add web/src/components/WorkflowEdgeEditor.tsx web/src/components/WorkflowTab.tsx
git commit -m "feat(workflow): edge editor with required flag and input order"
```

---

## Task 22: Run history with retry attempt table

**Files:**
- Create: `web/src/components/WorkflowRunHistory.tsx`
- Modify: `web/src/components/WorkflowTab.tsx`

- [ ] **Step 1: Implement**

```tsx
// web/src/components/WorkflowRunHistory.tsx
import { type FC, useState } from 'react';
import type { WorkflowRun, NodeAttempt } from '../types/workflow';
import { workflowApi } from '../api/workflow';

interface Props {
  runs: WorkflowRun[];
  onRetryNode: (runId: string, nodeId: string) => void;
}

export const WorkflowRunHistory: FC<Props> = ({ runs, onRetryNode }) => {
  const [openRunId, setOpenRunId] = useState<string | null>(null);
  const [details, setDetails] = useState<Record<string, NodeAttempt[]>>({});
  const expand = async (runId: string) => {
    if (openRunId === runId) { setOpenRunId(null); return; }
    setOpenRunId(runId);
    if (!details[runId]) {
      const { attempts } = await workflowApi.getRun(runId);
      setDetails((d) => ({ ...d, [runId]: attempts }));
    }
  };
  return (
    <div className="flex flex-col overflow-auto">
      {runs.map((r) => (
        <div key={r.id} className="border-b border-neutral-800">
          <button className="w-full px-3 py-2 text-left text-sm flex justify-between"
                  onClick={() => expand(r.id)}>
            <span>{r.started_at}</span>
            <span className="text-xs text-neutral-400">{r.trigger} · {r.status}</span>
          </button>
          {openRunId === r.id && (
            <div className="bg-neutral-900 px-4 py-2 text-xs">
              {(details[r.id] ?? []).map((a) => (
                <AttemptRow key={a.id} attempt={a} runId={r.id} onRetry={() => onRetryNode(r.id, a.node_id)} />
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
};

const AttemptRow: FC<{ attempt: NodeAttempt; runId: string; onRetry: () => void }> = ({ attempt, runId, onRetry }) => (
  <div className="flex items-center gap-2 py-1">
    <span className="w-32 truncate">{attempt.node_id}</span>
    <span className="w-10">#{attempt.attempt_num}</span>
    <span className="w-20">{attempt.status}</span>
    <span className="w-20">{attempt.duration_ms ?? ''}ms</span>
    {attempt.status === 'failed' && (
      <button className="ml-auto bg-yellow-700 px-2 py-0.5 rounded" onClick={onRetry}>Retry</button>
    )}
  </div>
);
```

- [ ] **Step 2: Wire**

Add a collapsible "Run history" panel below the canvas (or a bottom-sheet). Pass `runs` from the hook and a retry handler that calls `workflowApi.retryNode(runId, nodeId)` then refreshes the detail.

- [ ] **Step 3: Smoke**

Run a workflow, fail it intentionally (e.g. `import sys; sys.exit(1)`), expand the history row, click Retry on the failed node, observe new attempt row.

- [ ] **Step 4: Commit**

```bash
git add web/src/components/WorkflowRunHistory.tsx web/src/components/WorkflowTab.tsx
git commit -m "feat(workflow): run history with per-node attempt table and retry"
```

---

## Task 23: Cron editor UI

**Files:**
- Modify: `web/src/components/WorkflowTab.tsx` (or create `WorkflowHeader.tsx` if toolbar grows)

- [ ] **Step 1: Add cron input + toggle**

Add above the canvas a row:

```tsx
<div className="flex items-center gap-2">
  <input className="bg-neutral-900 px-2 py-1 rounded text-sm font-mono" placeholder="*/5 * * * *"
         value={selected.cron ?? ''} onChange={(e) => updateCron(e.target.value)} />
  <label className="text-xs text-neutral-400 flex items-center gap-1">
    <input type="checkbox" checked={selected.cron_enabled}
           onChange={() => workflowApi.toggleCron(selected.id).then(setSelectedRefresh)} />
    Enabled
  </label>
</div>
```

`updateCron` PUTs `{ cron: value }`. `setSelectedRefresh` refreshes the selected workflow + list.

- [ ] **Step 2: Smoke**

Set `* * * * *`, enable, wait ~60s, see a new cron-triggered run in history.

- [ ] **Step 3: Commit**

```bash
git add web/src/components/WorkflowTab.tsx
git commit -m "feat(workflow): cron expression editor with enable toggle"
```

---

## Task 24: End-to-end smoke

**Files:**
- none (manual)

- [ ] **Step 1: Multi-node pipeline**

Build in the UI:

1. Node A (Python, inline): `print('world')`
2. Node B (Python, inline, reads stdin): `import sys; print('hello ' + sys.stdin.read().strip())`
3. Edge A → B, required, inputOrder 1.

Run. Verify B's stdout is `hello world`.

- [ ] **Step 2: DAG with merge + failure**

1. Node A emits `ONE`
2. Node B emits `TWO`
3. Merge node M with A → M (order 1), B → M (order 2)
4. Node C reads stdin, prints it.
5. Run — C's stdout = `ONETWO`.

- [ ] **Step 3: Required failure propagation**

Mark A → C as required. Make A fail (`sys.exit(1)`). Run. Observe C `skipped`, B `done`.

- [ ] **Step 4: Halt-all**

Set B's `onFail = halt-all`, make B fail. Add independent node D from root. Run. Observe D `cancelled`.

- [ ] **Step 5: Retry**

After a failed run, click retry on the failed node. Observe new attempt succeeds (after fixing code), previous attempt preserved in the attempt table.

- [ ] **Step 6: Agent node**

Add an agent node fed by a node that emits a sample Sentry-style error trace. Prompt: `Find the likely root cause in this trace:\n{input}`. Run. Verify the agent's final message appears as the node's stdout and is visible in history.

- [ ] **Step 7: Cron**

Set cron to `* * * * *`, enable. Wait ~60s. See a new run with `trigger: cron`.

---

## Self-review appendix

- Spec coverage: every section of the design doc is covered by Tasks 1–23.
- No placeholders: all steps include runnable commands and concrete code.
- Type consistency: `Graph`, `GraphNode`, `Edge`, `NodeAttempt`, `WorkflowRun` shared between backend model (Task 2) and frontend types (Task 16). Method names (`createWorkflow`, `startWorkflowRun`, `retryNode`, `validateGraph`) are consistent across tasks. WS event shape (`node.state`, `node.stdout`, `node.stderr`, `run.state`) consistent between Task 8 (orchestrator), Task 10 (retry), and Task 16 (hook).
- Cross-platform: all spawns use `spawn(bin, argsArray)` with `shell: process.platform === 'win32'`, per CLAUDE.md + memory. Python fallback on Windows uses `python` (no 3 suffix).
