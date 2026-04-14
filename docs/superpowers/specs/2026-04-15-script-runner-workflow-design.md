# Script Runner (Workflow Tab) — Design

**Status:** draft for review
**Date:** 2026-04-15

## Overview

A new top-level tab, **Workflow**, that lets users build DAG-based script pipelines. Each node runs a Python / TypeScript / custom-command script (or an agent CLI), consumes raw text from stdin, and emits raw text to stdout. A node's stdout feeds downstream nodes through typed edges (required / optional). Workflows are repo-scoped, persisted in SQLite, and triggered manually or on a cron schedule.

The philosophy: the system provides execution orchestration and raw text plumbing. Scripts are responsible for their own data formats.

## Goals (v1)

- Header navigation: `Board | Task Analyst | Workflow` — three top-level tabs.
- Visual DAG editor on a D3 canvas with drag / pan / zoom.
- Node types: `script`, `agent`, `merge`.
- Host-shell execution of Python and TypeScript (built-in command presets), plus a "custom" language mode where the user supplies a run command.
- Script source: inline code (Monaco) or repo-relative file path.
- Edge roles: `required` (circuit breaker) or `optional` (side-task).
- Per-node failure behavior: `halt-subtree` (default) or `halt-all`.
- Fail-fast execution with per-node manual retry; retries re-run only the failed node.
- Multi-parent input delivered as concatenated stdout → stdin in user-specified order.
- Agent node uses existing `agent_profiles`, runs in proxy mode (single-shot), unrestricted tool use, final assistant message becomes stdout.
- Manual run trigger + optional cron schedule per workflow.
- Live canvas view: node colors for state, click opens stdin / stdout / stderr panel.
- Run history with per-node attempt list (retry lineage) per run.

## Out of scope (v1)

- Webhook / event triggers (cron + manual only).
- Docker / sandboxed execution.
- Typed ports or structured JSON data model (raw text only).
- Secrets / credential vault beyond what the host shell already exposes.
- Auto-retention / cleanup of old run outputs (user deletes explicitly).
- Workflow sharing between repos or workflow templates / marketplace.

## Architecture

### Backend

New module: `server-ts/src/workflow/`

```
workflow/
  model.ts            # types: Workflow, Graph, Node, Edge, Run, Attempt
  runner.ts           # monolithic graph execution engine (topological scheduler)
  nodeRunner.ts       # spawn a single node, I/O wiring, persistence
  agentAdapter.ts     # agent-kind nodes -> existing agent_profiles CLI
  scheduler.ts        # cron tick via node-cron; enqueues manual runs
```

Each file stays ≤300 lines (per CLAUDE.md).

New route: `server-ts/src/routes/workflow.ts` — CRUD, trigger, cancel, retry-node.

DB augment: `server-ts/src/db/workflow.ts` with `declare module` pattern that attaches methods to the existing `Db` class.

Process spawning reuses the existing `processManager` for tree-kill and lifecycle; scripts are spawned with `spawn(bin, argsArray)` — no shell escaping — and `shell: process.platform === 'win32'` for `.cmd` shim resolution on Windows.

WebSocket: existing `websocket.ts` gains a new topic `workflow:run:{runId}` that broadcasts per-node state transitions and incremental stdout / stderr chunks to the canvas.

### Frontend

New tab shell: `web/src/components/WorkflowTab.tsx`.

Logic lives in `web/src/hooks/useWorkflow.ts` (matches existing hook-per-domain convention).

Components:

- `WorkflowCanvas.tsx` — D3 SVG canvas: zoom / pan, node drag, edge draw, live node coloring.
- `WorkflowNodeEditor.tsx` — right-side panel: node kind, language, source (inline / file), run command override, on-fail policy, prompt template, agent profile.
- `WorkflowEdgeEditor.tsx` — edge inspector: required / optional, input order.
- `WorkflowRunHistory.tsx` — list of runs for the selected workflow; expanding a run shows nodes; expanding a node shows its attempts (the "self-referencing" retry table).
- `WorkflowList.tsx` — sidebar list of workflows for the selected repo; create / rename / delete / set cron.

Header nav change: `App.tsx` adds a top-level tab switcher for `board | analyst | workflow`. Task Analyst — currently a small icon — becomes a full tab. The three tabs share the app-level `selectedRepoId` state.

## Data model

Migration file: `server-ts/migrations/V20__add_workflows.sql`.

### `workflows`

| column         | type    | notes                                                  |
| -------------- | ------- | ------------------------------------------------------ |
| `id`           | TEXT PK |                                                        |
| `repo_id`      | TEXT    | FK `repos(id)` ON DELETE CASCADE                       |
| `name`         | TEXT    | NOT NULL                                               |
| `graph_json`   | TEXT    | NOT NULL — current editable graph                      |
| `cron`         | TEXT    | nullable; null = manual-only                           |
| `cron_enabled` | INTEGER | 0 / 1                                                  |
| `created_at`   | TEXT    | default `CURRENT_TIMESTAMP`                            |
| `updated_at`   | TEXT    | default `CURRENT_TIMESTAMP`, updated on graph/cron edit |

### `workflow_runs`

| column          | type    | notes                                                                      |
| --------------- | ------- | -------------------------------------------------------------------------- |
| `id`            | TEXT PK |                                                                            |
| `workflow_id`   | TEXT    | FK `workflows(id)` ON DELETE CASCADE                                       |
| `trigger`       | TEXT    | `manual` \| `cron`                                                         |
| `status`        | TEXT    | `running` \| `done` \| `failed` \| `halted` \| `cancelled`                 |
| `started_at`    | TEXT    | NOT NULL                                                                   |
| `ended_at`      | TEXT    | nullable                                                                   |
| `snapshot_json` | TEXT    | NOT NULL — graph at run start, so later workflow edits do not alter history |

### `workflow_node_attempts`

| column          | type    | notes                                                                                       |
| --------------- | ------- | ------------------------------------------------------------------------------------------- |
| `id`            | TEXT PK |                                                                                             |
| `run_id`        | TEXT    | FK `workflow_runs(id)` ON DELETE CASCADE                                                    |
| `node_id`       | TEXT    | id within `snapshot_json.nodes`                                                             |
| `attempt_num`   | INTEGER | 1-based, increments on retry                                                                |
| `status`        | TEXT    | `pending` \| `running` \| `done` \| `failed` \| `skipped` \| `cancelled`                    |
| `started_at`    | TEXT    | nullable                                                                                    |
| `ended_at`      | TEXT    | nullable                                                                                    |
| `exit_code`     | INTEGER | nullable                                                                                    |
| `duration_ms`   | INTEGER | nullable                                                                                    |
| `stdout_inline` | TEXT    | first 1 MiB of stdout                                                                       |
| `stderr_inline` | TEXT    | first 1 MiB of stderr                                                                       |
| `stdout_file`   | TEXT    | overflow path — `APP_DATA_DIR/workflow_outputs/{run_id}/{attempt_id}.stdout`                |
| `stderr_file`   | TEXT    | overflow path                                                                               |

Unique: `(run_id, node_id, attempt_num)`.

### Graph JSON schema

Shared shape for `workflows.graph_json` and `workflow_runs.snapshot_json`:

```ts
type Graph = {
  nodes: Node[];
  edges: Edge[];
};

type Node =
  | ScriptNode
  | AgentNode
  | MergeNode;

interface NodeBase {
  id: string;                  // UUID
  label: string;
  position: { x: number; y: number };
  onFail: 'halt-subtree' | 'halt-all';
}

interface ScriptNode extends NodeBase {
  kind: 'script';
  lang: 'python' | 'typescript' | 'custom';
  source: 'inline' | 'file';
  code?: string;               // when source === 'inline'
  filePath?: string;           // repo-relative, when source === 'file'
  runCommand?: string;         // required when lang === 'custom'; supports {file} placeholder
}

interface AgentNode extends NodeBase {
  kind: 'agent';
  agentProfileId: string;
  promptTemplate: string;      // supports {input} placeholder
}

interface MergeNode extends NodeBase {
  kind: 'merge';
  // inputs are concatenated to stdout in edge inputOrder — no config needed
}

interface Edge {
  id: string;
  from: string;                // node id
  to: string;                  // node id
  required: boolean;           // true = circuit breaker edge
  inputOrder: number;          // 1-based stdin concat order on the `to` node
}
```

`inputOrder` is unique per `to` node. The UI enforces this and auto-renumbers on insert / delete.

## Execution engine (`workflow/runner.ts`)

Monolithic A-approach: a single class owns the full run lifecycle.

### Start

1. Load workflow, deep-copy `graph_json` into `snapshot_json`.
2. Insert `workflow_runs` row, status `running`.
3. Compute topological layers. Cycles are prevented at save time (see "Error handling"); if one is detected at run time as a safety net, the run is set to `failed` with a synthetic attempt carrying a descriptive stderr.
4. Seed "ready" set: nodes with no incoming edges.

### Tick

While the ready set is non-empty and the run is not `halted` / `cancelled`:

- Pop all ready nodes, spawn each in parallel via `nodeRunner.run(node, snapshot, runId)`.
- A node is ready when every parent edge's source node has reached a terminal state (`done`, `failed`, or `skipped`) AND every `required=true` incoming edge has a `done` source.
- A node is `skipped` when any of its `required=true` parent edges has a non-`done` source.
- On any node's completion, re-evaluate the ready set.

### Failure handling

- A script / agent node is `failed` when `exit_code !== 0` or the agent returns an error.
- If the failed node's `onFail === 'halt-all'`, the run transitions to `halted`; all non-terminal nodes are marked `cancelled`. No new nodes start.
- If `onFail === 'halt-subtree'`, only descendants through `required=true` edges are `skipped`. Other branches continue.
- Run transitions to `failed` when no non-terminal nodes remain and at least one ended in `failed`. `done` when all nodes ended `done` or `skipped` via optional edges only. `halted` / `cancelled` per above.

### Node retry

`POST /workflow/runs/:runId/nodes/:nodeId/retry`:

- Only allowed when the run is `failed` or `halted` AND the target node's latest attempt is `failed`.
- Inserts a new `workflow_node_attempts` row with `attempt_num = max + 1`.
- Re-runs only that node, using cached stdouts from already-`done` parents (from `stdout_inline` / `stdout_file`).
- On success, downstream nodes remain `skipped` / `cancelled` — the user explicitly retries each downstream node they care about, or triggers a fresh run. This keeps retry semantics simple and predictable.

Rationale for shallow retry: a deep cascade re-run is indistinguishable from a fresh run; the value of retry is to recover from a single flaky step without re-doing upstream work.

### Node I/O (`workflow/nodeRunner.ts`)

- Resolve command:
  - `python` → `python3 {file}` (fallback `python` on Windows).
  - `typescript` → `npx -y tsx {file}`.
  - `custom` → user's `runCommand` with `{file}` replaced.
- For `source === 'inline'`, write code to a temp file under `APP_DATA_DIR/workflow_tmp/{run_id}/{attempt_id}.{ext}`.
- For `source === 'file'`, resolve `filePath` against the repo root.
- Build stdin: for each incoming edge, fetch the source node's latest-`done` attempt stdout, ordered by `edge.inputOrder` ascending, concatenate with no delimiter, write to the child process's stdin and close.
- Capture stdout / stderr streams: in-memory ring buffer up to 1 MiB each; beyond that, tee to the overflow file path on disk. Chunks broadcast over WS as they arrive.
- Use `spawn(bin, argsArray, { cwd: repoRoot, shell: process.platform === 'win32' })`. Register process in `processManager` so cancel / tree-kill works.
- On exit: write final `status`, `exit_code`, `duration_ms`, finalize outputs.

### Agent node (`workflow/agentAdapter.ts`)

Analogous to `analystService.ts`. Differences:

- System prompt declares proxy mode + single-message completion (no interactive follow-up):
  > You are an agent invoked from a Workflow pipeline controlled by a proxy system. Emit exactly one final message that fully answers the request. Tool use is allowed; when done, produce your final response.
- User message is the `promptTemplate` with `{input}` replaced by the stdin payload (the concatenated parent stdouts). Additional placeholder: `{repo}` (absolute path).
- Agent is spawned via `agent_profiles` using the same spawn helpers the existing analyst and executor paths use.
- Tool use is unrestricted — matches user direction.
- Output stream is parsed for the agent's final assistant message only; intermediate thinking / tool-use is dropped from stdout but kept in stderr for debugging.

### Merge node

No configuration. Internally behaves as `cat` over its inputs in `inputOrder`. Emitted as stdout unchanged. The UI presents it as a visually distinct diamond.

## Scheduler (`workflow/scheduler.ts`)

- On app boot, load all workflows with `cron_enabled = 1 AND cron IS NOT NULL`, register with `node-cron`.
- On workflow create / update / delete, refresh the scheduler registration for that workflow id.
- Cron fire: start a run with `trigger='cron'`. If the previous cron run is still `running`, skip this tick and log a warning — no overlap.
- Timezone: user's local via `node-cron` default (`Intl.DateTimeFormat().resolvedOptions().timeZone`).

## HTTP API

All endpoints are scoped to the currently active repo.

| Method | Path                                                         | Purpose                                          |
| ------ | ------------------------------------------------------------ | ------------------------------------------------ |
| GET    | `/workflow?repoId=...`                                       | list workflows for a repo                        |
| POST   | `/workflow`                                                  | create workflow (body: repoId, name, graph)      |
| GET    | `/workflow/:id`                                              | fetch single workflow                            |
| PUT    | `/workflow/:id`                                              | update graph, name, cron                         |
| DELETE | `/workflow/:id`                                              | delete workflow (cascades runs + attempts)       |
| POST   | `/workflow/:id/run`                                          | trigger manual run, returns `runId`              |
| POST   | `/workflow/:id/cron/toggle`                                  | enable / disable cron                            |
| GET    | `/workflow/:id/runs`                                         | list runs (paginated)                            |
| GET    | `/workflow/runs/:runId`                                      | run + attempts                                   |
| GET    | `/workflow/runs/:runId/attempts/:attemptId/stdout`           | full stdout (streams from file if overflow)      |
| GET    | `/workflow/runs/:runId/attempts/:attemptId/stderr`           | full stderr                                      |
| POST   | `/workflow/runs/:runId/cancel`                               | cancel running run                               |
| POST   | `/workflow/runs/:runId/nodes/:nodeId/retry`                  | retry a failed node                              |

Errors use the existing `ApiError` → `toResponse(res)` pattern.

## WebSocket events

Topic `workflow:run:{runId}`:

- `node.state` — `{ nodeId, attemptId, status, startedAt?, endedAt?, exitCode? }`
- `node.stdout` — `{ nodeId, attemptId, chunk }` (base64-safe string)
- `node.stderr` — same shape
- `run.state` — `{ status, endedAt? }` when the run transitions

Canvas subscribes on run open; run history view subscribes when expanding a live run.

## UI — canvas & editor

### Canvas (D3)

- SVG root with `<g class="pan-zoom">` that `d3-zoom` drives.
- Nodes: `<g class="node">` with a background rect, title, small kind icon, and status indicator (CSS-driven color).
  - `pending` — neutral gray.
  - `running` — blue + pulsing outline.
  - `done` — green.
  - `failed` — red.
  - `skipped` — muted striped.
  - `cancelled` — muted.
- Node drag: `d3-drag` updates `position` locally and on release persists via `PUT /workflow/:id`.
- Edges: quadratic bezier between node output / input anchors. Color by role — solid (required) or dashed (optional). Input order labeled near the target anchor.
- Edge creation: drag from a source's output anchor to a target's input anchor. Defaults to `required=true`, next `inputOrder`.
- Selection model: click a node or edge to open the right-side editor panel; blank canvas click clears selection.
- Context menu: right-click a node for `Delete` / `Duplicate` / `Set as halt-all`. Right-click an edge for `Toggle required` / `Delete` / `Reorder input`.

### Editor panel

- Node editor switches its field set by `kind`.
- Monaco editor for `ScriptNode.code` with `python` / `typescript` language mode.
- File-path mode: folder picker rooted at the repo with filename autocomplete.
- For `lang === 'custom'`, a `runCommand` input with a `{file}` hint.
- Agent editor: `agent_profiles` dropdown, prompt template textarea with monospace font, `{input}` / `{repo}` inline help.

### Run history

- List view per workflow: `[started_at] [trigger] [status] [duration]` with "retry node" action surfaced when a failed run has a retryable node.
- Expanding a run shows nodes in topological order; each node has a chevron that reveals its attempt rows — the "self-referencing" retry table.
- Attempt row: `attempt_num`, `status`, `exit_code`, `duration`, `started_at`. Click opens a drawer with full stdout / stderr (virtualized for long outputs).

## Cross-platform

- All spawns use `spawn(bin, argsArray)` — no `execSync(string)`, no shell escaping (per CLAUDE.md and memory).
- `shell: process.platform === 'win32'` for `.cmd` shim resolution of `tsx`, `npx`, `python`.
- Process termination via existing `tree-kill` helper.
- `APP_DATA_DIR` resolution uses the existing cross-platform helper: macOS `~/Library/Application Support/branching-bad/`, Linux `~/.local/share/branching-bad/`, Windows `%APPDATA%\branching-bad\`.

## Error handling conventions

- Config validation at save time: no cycles; `inputOrder` unique per `to` node; exactly one `lang` per script node; `custom` lang requires `runCommand`; agent node requires `agentProfileId` and `promptTemplate`.
- Run-time surface: validation errors become an immediate synthetic failed attempt with stderr describing the issue rather than rejecting the trigger.
- Script spawn failure (binary not on PATH) → node `failed` with stderr `"python3 not found on PATH"` — caught by the spawn handler, no crash.
- Orphan cleanup: app boot cancels any `running` runs left over from a crash via the existing `staleRunCleaner` pattern — extend to include `workflow_runs`.

## Testing

- Unit tests (`server-ts/tests/workflow/`) for `runner.ts` with a fake `nodeRunner`: cycle rejection, required-edge propagation, halt-all, retry semantics, cron overlap skip.
- Integration test: small end-to-end pipeline `echo "a" → concat → echo "z"` using real spawns.
- Frontend: `hooks/useWorkflow.test.ts` for WS reducer transitions; snapshot test for canvas rendering states.

## Open questions

None remaining from the clarification phase. Implementation plan will enumerate files and sequence.
