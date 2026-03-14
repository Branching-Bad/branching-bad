# Task Defaults & UX Improvements — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add repo+provider task defaults, ARCHIVED state, branch auto-commit, apply-to-main options, and real-time UI updates.

**Architecture:** New `task_defaults` table + CRUD. Extend task state machine with ARCHIVED. Auto-commit on branch after runs. Apply-to-main gets committed/unstaged options + branch reset. WebSocket broadcast for UI sync.

**Tech Stack:** Express, better-sqlite3, React 19, Tailwind v4, WebSocket

---

## Batch 1: Task Defaults (Backend)

### Task 1: Migration + DB layer

**Files:**
- Create: `server-ts/migrations/V18__task_defaults.sql`
- Create: `server-ts/src/db/taskDefaults.ts`
- Modify: `server-ts/src/models/task.ts`

- [ ] **Step 1: Create migration file**

```sql
-- server-ts/migrations/V18__task_defaults.sql
CREATE TABLE IF NOT EXISTS task_defaults (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  repo_id TEXT NOT NULL REFERENCES repos(id) ON DELETE CASCADE,
  provider_name TEXT,
  require_plan INTEGER NOT NULL DEFAULT 1,
  auto_start INTEGER NOT NULL DEFAULT 0,
  auto_approve_plan INTEGER NOT NULL DEFAULT 0,
  use_worktree INTEGER NOT NULL DEFAULT 1,
  carry_dirty_state INTEGER NOT NULL DEFAULT 0,
  priority TEXT,
  UNIQUE(repo_id, provider_name)
);
```

- [ ] **Step 2: Add TaskDefaults type to models**

Add to `server-ts/src/models/task.ts`:

```typescript
export interface TaskDefaults {
  id: number;
  repo_id: string;
  provider_name: string | null;
  require_plan: boolean;
  auto_start: boolean;
  auto_approve_plan: boolean;
  use_worktree: boolean;
  carry_dirty_state: boolean;
  priority: string | null;
}
```

- [ ] **Step 3: Create db/taskDefaults.ts**

```typescript
import type { TaskDefaults } from '../models.js';
import { Db } from './index.js';

declare module './index.js' {
  interface Db {
    getTaskDefaults(repoId: string, providerName?: string | null): TaskDefaults | null;
    listTaskDefaults(repoId: string): TaskDefaults[];
    upsertTaskDefaults(repoId: string, providerName: string | null, fields: Omit<TaskDefaults, 'id' | 'repo_id' | 'provider_name'>): void;
    deleteTaskDefaults(repoId: string, providerName: string | null): void;
    resolveTaskDefaults(repoId: string, providerName?: string | null): Partial<TaskDefaults>;
  }
}
```

`resolveTaskDefaults` implements the 3-tier resolution:
1. If `providerName` given → look up provider override
2. Fall back to repo default (`provider_name IS NULL`)
3. Return empty object if nothing found (hardcoded defaults apply in `createManualTask`)

- [ ] **Step 4: Verify build**

Run: `cd /Users/melih/Documents/code/idea && npm run check:server`

- [ ] **Step 5: Commit**

```
feat: add task_defaults table and db layer
```

### Task 2: REST endpoints

**Files:**
- Create: `server-ts/src/routes/taskDefaults.ts`
- Modify: `server-ts/src/app.ts`
- Modify: `server-ts/src/db/tasks.ts`

- [ ] **Step 1: Create routes/taskDefaults.ts**

Endpoints:
- `GET /api/repos/:repoId/task-defaults` → list all defaults for repo (repo + provider overrides)
- `GET /api/repos/:repoId/task-defaults/resolve?provider=` → resolve effective defaults (3-tier)
- `PUT /api/repos/:repoId/task-defaults` → upsert (body: `{ providerName?, requirePlan, autoStart, ... }`)
- `DELETE /api/repos/:repoId/task-defaults?provider=` → delete specific override

- [ ] **Step 2: Mount in app.ts**

Add import and `app.use(taskDefaultsRoutes())` after `app.use(taskRoutes())`.

- [ ] **Step 3: Wire defaults into createManualTask**

In `server-ts/src/db/tasks.ts` `createManualTask()`, before applying hardcoded defaults, call `this.resolveTaskDefaults(payload.repoId, payload.source)`. Only use resolved values for fields NOT explicitly provided in payload.

```typescript
const defaults = this.resolveTaskDefaults(payload.repoId);
const requirePlan = payload.requirePlan ?? defaults.require_plan ?? true;
const autoStart = payload.autoStart ?? defaults.auto_start ?? false;
// ... etc
```

- [ ] **Step 4: Verify build**

Run: `cd /Users/melih/Documents/code/idea && npm run check:server`

- [ ] **Step 5: Commit**

```
feat: add task-defaults REST endpoints and wire into task creation
```

---

## Batch 2: Task Defaults (Frontend)

### Task 3: Settings UI for task defaults

**Files:**
- Modify: `web/src/components/SettingsModal.tsx`
- Modify: `web/src/types.ts`

- [ ] **Step 1: Add TaskDefaults type to frontend types.ts**

```typescript
export type TaskDefaults = {
  id: number;
  repo_id: string;
  provider_name: string | null;
  require_plan: boolean;
  auto_start: boolean;
  auto_approve_plan: boolean;
  use_worktree: boolean;
  carry_dirty_state: boolean;
  priority: string | null;
};
```

- [ ] **Step 2: Add Task Defaults section in Settings Repository tab**

After the BuildCommandSection in the "repo" tab, add a new section showing:
- Repo defaults (checkbox row for each boolean + priority select)
- Per-provider override sections (one per connected provider)
- "+ Add Override" button for providers without overrides
- Each section has a "Save" button that calls `PUT /api/repos/:repoId/task-defaults`

- [ ] **Step 3: Verify build**

Run: `cd /Users/melih/Documents/code/idea/web && npx eslint . && cd .. && npm run build`

- [ ] **Step 4: Commit**

```
feat: add task defaults settings UI in repository tab
```

### Task 4: Pre-fill CreateTaskModal from defaults

**Files:**
- Modify: `web/src/components/CreateTaskModal.tsx`
- Modify: `web/src/hooks/useTaskState.ts`

- [ ] **Step 1: Fetch resolved defaults on modal open**

In `CreateTaskModalInner`, on mount call `GET /api/repos/:repoId/task-defaults/resolve` and use the response to set initial state values instead of hardcoded booleans.

- [ ] **Step 2: Pass repoId to CreateTaskModal**

Add `repoId` prop so the modal can fetch defaults.

- [ ] **Step 3: Verify build**

Run: `cd /Users/melih/Documents/code/idea/web && npx eslint . && cd .. && npm run build`

- [ ] **Step 4: Commit**

```
feat: pre-fill task creation form from repo/provider defaults
```

---

## Batch 3: ARCHIVED State

### Task 5: Backend — ARCHIVED status

**Files:**
- Modify: `server-ts/src/models/task.ts` (no change needed — status is string)
- Modify: `server-ts/src/routes/taskCrudUpdate.ts`
- Modify: `server-ts/src/executor/git-write.ts`

- [ ] **Step 1: Allow ARCHIVED transition in taskCrudUpdate**

In `PATCH /api/tasks/:task_id/status`, add `ARCHIVED` as valid target status from `DONE`. When transitioning to ARCHIVED:
1. Update task status
2. Get latest run for task
3. If run has `worktree_path` → call `removeWorktree(repoPath, branchName, worktreePath)`
4. Clear run's `worktree_path` in DB

- [ ] **Step 2: Verify removeWorktree exists and works**

Check `executor/git-write.ts` for `removeWorktree`. If it doesn't exist, create it:
```typescript
export function removeWorktree(repoPath: string, branchName: string, worktreePath: string): void {
  execGit(repoPath, ['worktree', 'remove', worktreePath, '--force']);
  execGit(repoPath, ['branch', '-D', branchName]);
}
```

- [ ] **Step 3: Verify build**

Run: `cd /Users/melih/Documents/code/idea && npm run check:server`

- [ ] **Step 4: Commit**

```
feat: add ARCHIVED task status with worktree cleanup
```

### Task 6: Frontend — ARCHIVED lane + Archive button

**Files:**
- Modify: `web/src/components/shared.ts` (if `laneFromStatus` needs update)
- Modify: `web/src/hooks/useTaskState.ts`
- Modify: `web/src/components/MergeOptionsBar.tsx`

- [ ] **Step 1: Update laneFromStatus to handle ARCHIVED**

Ensure `laneFromStatus('ARCHIVED')` returns `'archived'`. Check `shared.ts`.

- [ ] **Step 2: Add Archive button in MergeOptionsBar**

After "Mark as Done" button, add "Archive" button visible only when `status === 'DONE'`:

```tsx
{selectedTask.status === "DONE" && (
  <button onClick={onArchiveTask} disabled={busy}
    className="rounded-md border border-border-strong bg-surface-100 px-3 py-1 text-xs font-medium text-text-muted transition hover:bg-surface-200">
    Archive
  </button>
)}
```

- [ ] **Step 3: Add onArchiveTask handler in useTaskState**

Calls `PATCH /api/tasks/:id/status` with `{ status: 'ARCHIVED' }`.

- [ ] **Step 4: Show ARCHIVED tasks in collapsed section**

In the kanban/task list UI, show archived tasks in a collapsible section below DONE.

- [ ] **Step 5: Verify build**

Run: `cd /Users/melih/Documents/code/idea/web && npx eslint . && cd .. && npm run build`

- [ ] **Step 6: Commit**

```
feat: add archive button and ARCHIVED lane in UI
```

---

## Batch 4: Branch Auto-Commit + Apply-to-Main Improvements

### Task 7: Auto-commit after agent run

**Files:**
- Modify: `server-ts/src/processManager.ts` (or wherever exit monitor runs)
- Modify: `server-ts/src/executor/git-write.ts`

- [ ] **Step 1: Find where run completion is handled**

Look at `processManager.spawnExitMonitor` — this fires when agent exits. After status update, before anything else, auto-commit if there are changes.

- [ ] **Step 2: Add auto-commit logic**

```typescript
// In exit monitor, after agent exits with code 0:
const status = execGit(worktreeDir, ['status', '--porcelain']);
if (status.success && status.stdout.trim()) {
  execGit(worktreeDir, ['add', '-A']);
  execGit(worktreeDir, ['commit', '-m', `run #${runId}: ${taskTitle}`]);
}
```

- [ ] **Step 3: Verify build**

Run: `cd /Users/melih/Documents/code/idea && npm run check:server`

- [ ] **Step 4: Commit**

```
feat: auto-commit changes on branch after successful agent run
```

### Task 8: Apply-to-main branch reset

**Files:**
- Modify: `server-ts/src/services/mergeService.ts`
- Modify: `server-ts/src/executor/merge.ts`

- [ ] **Step 1: Add branch reset after successful apply**

In `mergeService.applyToMain()`, after successful apply (any strategy), reset the worktree branch to main HEAD:

```typescript
if (applyResult.ok && run.worktree_path) {
  // Reset branch to main HEAD for clean followup
  execGit(run.worktree_path, ['reset', '--hard', baseBranch]);
}
```

- [ ] **Step 2: Verify build**

Run: `cd /Users/melih/Documents/code/idea && npm run check:server`

- [ ] **Step 3: Commit**

```
feat: reset worktree branch to main HEAD after apply-to-main
```

### Task 9: WebSocket broadcast after apply-to-main

**Files:**
- Modify: `server-ts/src/services/mergeService.ts`
- Modify: `server-ts/src/websocket.ts` (if globalBroadcast not already exported)
- Modify: `web/src/hooks/useTaskState.ts`

- [ ] **Step 1: Broadcast task_applied event**

In `mergeService.applyToMain()`, after successful apply, broadcast via WebSocket:

```typescript
import { globalBroadcast } from '../websocket.js';

// After successful apply:
globalBroadcast({
  type: 'task_applied',
  taskId,
  strategy,
  committed: autoCommit,
  filesChanged: applyResult.result.filesChanged,
});
```

- [ ] **Step 2: Listen in frontend useTaskState**

In `useTaskState`, subscribe to global WS events. When `task_applied` received for current task:
- Call `refreshTasks()` to reload task list
- Show toast: "Changes applied to main"

- [ ] **Step 3: Verify build**

Run: `cd /Users/melih/Documents/code/idea && npm run build`

- [ ] **Step 4: Commit**

```
feat: broadcast task_applied WS event and update UI in real-time
```

---

## Summary

| Batch | Tasks | Description |
|-------|-------|-------------|
| 1 | 1-2 | Task defaults backend (migration, DB, routes) |
| 2 | 3-4 | Task defaults frontend (settings UI, modal pre-fill) |
| 3 | 5-6 | ARCHIVED status (backend + frontend) |
| 4 | 7-9 | Auto-commit, branch reset, WS broadcast |

Batches are independent — can be parallelized across subagents.
