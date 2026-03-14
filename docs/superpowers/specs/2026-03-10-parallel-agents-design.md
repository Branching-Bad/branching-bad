# Parallel Agent Execution & Conflict-Resolving Merge

## Summary

Enable multiple agents to run simultaneously across tasks and repos. Add a StatusBar for monitoring/controlling active runs. Implement agent-assisted conflict resolution during merge-to-main.

## Requirements

1. **Parallel execution** — No limit on concurrent runs. Same repo (different tasks) + cross-repo
2. **Worktree enforcement** — Parallel runs in same repo auto-upgrade to worktree mode
3. **StatusBar** — Fixed bottom bar showing all active/stopped/completed runs with cancel/resume controls
4. **Live output replay** — Switch between tasks freely; DB-persisted events replay on reconnect
5. **In-app notifications** — Toast when a run finishes while user is viewing another task
6. **Conflict-resolving merge** — Agent resolves conflicts preserving both sides' changes, or user opts for manual
7. **Cancel/Resume** — Cancel any running agent; resume stopped agents via `--resume`

## Backend Changes

### 1. Remove per-repo single-run lock

**Files:** `runService.ts`, `reviewService.ts`

Remove `hasRunningRunForRepo()` guard. When a parallel run starts in the same repo and task has `use_worktree=false`, auto-upgrade to worktree mode for that run.

### 2. New endpoints

| Method | Path | Purpose |
|--------|------|---------|
| POST | `/api/runs/:runId/cancel` | Kill agent process via ProcessManager |
| POST | `/api/runs/:runId/resume` | Start new run with `--resume` using previous `agent_session_id` |
| POST | `/api/tasks/:taskId/resolve-conflicts` | Start conflict-resolver agent run |
| GET | `/api/runs/active` | List all active runs across all repos |

### 3. ProcessManager additions

- `cancelRun(runId)` — public method wrapping existing kill logic (tree-kill on Unix, taskkill on Windows)
- No structural changes needed — already supports N concurrent processes

### 4. Global WebSocket events

Add to existing `/api/ws` endpoint:

```typescript
// New event types on the global WS
{ type: 'run_started', runId, taskId, repoId, taskTitle }
{ type: 'run_finished', runId, taskId, repoId, taskTitle, status: 'done'|'failed' }
{ type: 'run_cancelled', runId, taskId, repoId, taskTitle }
```

Emitted from `runService` and `processManager` at lifecycle transitions. Lightweight — no log content, just status changes.

### 5. Conflict-resolving merge

**File:** `merge.ts`, new `conflictResolverService.ts`

Current squash merge flow: `git merge --squash --no-commit` → unstaged changes on main.

New conflict flow:
1. Squash merge attempted, conflict detected
2. Return `{ ok: false, conflict: { conflictedFiles } }` (existing behavior)
3. User chooses "Agent resolves" or "Manual"
4. If agent: `POST /api/tasks/:taskId/resolve-conflicts`
   - Starts agent in the worktree where conflict markers exist
   - Prompt: "Resolve git merge conflicts in these files. Preserve ALL changes from both sides — both branches contain critical work. Remove conflict markers (`<<<<<<<`, `=======`, `>>>>>>>`), produce correct merged result. Do NOT commit."
   - Agent edits conflicted files, removes markers
   - Result: clean unstaged changes on main, no commit
5. If agent fails or user chooses manual: existing behavior (conflict files listed)

## Frontend Changes

### 1. StatusBar component

Fixed bar at screen bottom. Behavior per run state:

| State | Icon | Controls | Click action |
|-------|------|----------|-------------|
| Running | Animated spinner | Cancel button | Open task drawer |
| Stopped/Cancelled | Static icon | Resume button | Open task drawer |
| Completed (done) | Checkmark (✓) | — | Open task drawer, then remove from bar |
| Completed (failed) | Error icon (✗) | Resume button | Open task drawer, then remove from bar |

- Completed runs stay in StatusBar until user opens that task's drawer
- If run's repo differs from current, clicking switches repo first then opens drawer
- Bar hidden when no runs to show

### 2. useRunState changes

```typescript
// Before
activeRun: ActiveRun | null

// After
activeRuns: Map<string, ActiveRun>  // key: runId
globalActiveRuns: ActiveRunSummary[] // all repos, fed by global WS
```

`selectedTaskRunState` still works — filters by selected task. No change to how detail sidebar displays a single run's output.

### 3. useEventStream changes

- Subscribe to global WS events (`run_started/finished/cancelled`)
- Maintain per-run WS connections for live log streaming (existing)
- Multiple per-run connections can be open simultaneously
- On task switch: open new per-run WS, keep others alive in background
- On reconnect: DB replay fills gaps (existing behavior)

### 4. Toast notifications

When `run_finished` or `run_cancelled` arrives via global WS and user is not viewing that task:
- Show toast: "✓ [Task title] tamamlandı" or "✗ [Task title] başarısız"
- Toast click → navigate to that task (switch repo if needed)

### 5. DiffReviewPanel — conflict resolution UI

When merge returns conflict:
- Show conflicted file list (existing)
- Two buttons: "Agent Çözsün" | "Manuel Çözeceğim"
- "Agent Çözsün" → calls `POST /api/tasks/:taskId/resolve-conflicts`, shows progress in run panel
- "Manuel Çözeceğim" → existing behavior

## What stays unchanged

- WebSocket routing (`websocket.ts`) — already per-resource
- ProcessManager structure — already supports N processes
- MsgStore — already per-run isolated
- DB schema — `run_events` already per-run, no new tables needed
- Per-run WS endpoints — unchanged
- Detail sidebar — shows selected task's run as before

## Implementation batches

### Batch 1: Backend parallel unlock
- Remove `hasRunningRunForRepo()` from runService + reviewService
- Add worktree auto-upgrade logic
- Add `GET /api/runs/active` endpoint
- Add `POST /api/runs/:runId/cancel` endpoint
- Add `POST /api/runs/:runId/resume` endpoint

### Batch 2: Global WS events + StatusBar
- Add global WS event emission (run_started/finished/cancelled)
- Frontend: `useRunState` → activeRuns Map + globalActiveRuns
- Frontend: `useEventStream` → global WS subscription
- Frontend: `<StatusBar>` component

### Batch 3: Toast notifications + multi-run UX
- Toast notification system for background run completion
- Per-run WS connections kept alive across task switches
- DB replay on reconnect for missed events
- StatusBar click → repo switch + drawer open

### Batch 4: Conflict-resolving merge
- `conflictResolverService.ts` — agent-assisted conflict resolution
- `POST /api/tasks/:taskId/resolve-conflicts` endpoint
- DiffReviewPanel — "Agent Çözsün" / "Manuel Çözeceğim" buttons
- Conflict resolver prompt engineering
