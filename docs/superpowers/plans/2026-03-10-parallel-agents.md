# Parallel Agent Execution Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enable unlimited parallel agent runs across tasks and repos, with StatusBar controls, toast notifications, and agent-assisted conflict resolution.

**Architecture:** Remove per-repo single-run lock, auto-upgrade to worktree for parallel same-repo runs. Add global WS events for cross-repo awareness. New StatusBar component for monitoring. Agent-based conflict resolver for merge.

**Tech Stack:** Express, ws, better-sqlite3, React 19, Tailwind v4, tree-kill

---

## File Structure

### Backend — New files
| File | Responsibility |
|------|---------------|
| `server-ts/src/services/conflictResolverService.ts` | Agent-assisted conflict resolution |
| `server-ts/src/routes/runControls.ts` | Cancel/resume/active-list endpoints |

### Backend — Modified files
| File | Change |
|------|--------|
| `server-ts/src/services/runService.ts` | Remove hasRunningRunForRepo, add worktree auto-upgrade |
| `server-ts/src/services/reviewService.ts` | Remove hasRunningRunForRepo |
| `server-ts/src/processManager.ts` | Add public cancelRun method |
| `server-ts/src/websocket.ts` | Add global WS event emission |
| `server-ts/src/executor/merge.ts` | No change — conflict detection already works |
| `server-ts/src/app.ts` | Mount new runControls router |

### Frontend — New files
| File | Responsibility |
|------|---------------|
| `web/src/components/StatusBar.tsx` | Bottom bar with active/stopped/completed runs |
| `web/src/components/ToastNotification.tsx` | In-app toast for background run completion |
| `web/src/hooks/useGlobalRuns.ts` | Global active runs state from WS events |
| `web/src/hooks/useToast.ts` | Toast notification state management |

### Frontend — Modified files
| File | Change |
|------|--------|
| `web/src/hooks/useRunState.ts` | Support multiple activeRuns |
| `web/src/hooks/useEventStream.ts` | Add global WS event subscription |
| `web/src/App.tsx` | Add StatusBar + ToastNotification |
| `web/src/components/DiffReviewPanel.tsx` | Add "Agent Çözsün" / "Manuel Çözeceğim" buttons |
| `web/src/types.ts` | Add GlobalActiveRun, ToastMessage types |

---

## Chunk 1: Backend Parallel Unlock

### Task 1: Remove per-repo single-run lock from runService

**Files:**
- Modify: `server-ts/src/services/runService.ts:37-41,129-131`

- [ ] **Step 1: Remove lock in startRunInternal**

In `server-ts/src/services/runService.ts`, replace lines 37-41:
```typescript
// REMOVE THIS BLOCK:
if (state.db.hasRunningRunForRepo(repo.id)) {
  throw ApiError.conflict(
    'Another run is already active for this repository. Wait for it to finish.',
  );
}
```

With worktree auto-upgrade:
```typescript
// Auto-upgrade to worktree if another run is active in same repo
if (state.db.hasRunningRunForRepo(repo.id)) {
  task = { ...task, use_worktree: true };
}
```

- [ ] **Step 2: Remove lock in resumeRunInternal**

In same file, replace lines 129-131:
```typescript
// REMOVE THIS BLOCK:
if (state.db.hasRunningRunForRepo(repo.id)) {
  throw ApiError.conflict('Another run is already active for this repository.');
}
```

With same auto-upgrade:
```typescript
if (state.db.hasRunningRunForRepo(repo.id)) {
  useWorktree = true;
}
```

Note: `resumeRunInternal` may use a local `useWorktree` variable — check actual parameter name and adapt.

- [ ] **Step 3: Verify server compiles**

Run: `cd /Users/melih/Documents/code/idea && npm run check:server`
Expected: No type errors

- [ ] **Step 4: Commit**

```bash
git add server-ts/src/services/runService.ts
git commit -m "feat: remove per-repo single-run lock, auto-upgrade to worktree for parallel runs"
```

---

### Task 2: Remove per-repo lock from reviewService

**Files:**
- Modify: `server-ts/src/services/reviewService.ts:92-95,230-233`

- [ ] **Step 1: Remove lock in submitReview**

In `server-ts/src/services/reviewService.ts`, replace lines 92-95:
```typescript
// REMOVE:
cleanStaleRuns(state, repo.id);
if (state.db.hasRunningRunForRepo(repo.id)) {
  throw ApiError.conflict('Another run is already active for this repository.');
}
```

With:
```typescript
cleanStaleRuns(state, repo.id);
// Parallel runs allowed — no single-run lock
```

- [ ] **Step 2: Remove lock in resendReview**

Same file, replace lines 230-233 with same pattern.

- [ ] **Step 3: Verify server compiles**

Run: `npm run check:server`

- [ ] **Step 4: Commit**

```bash
git add server-ts/src/services/reviewService.ts
git commit -m "feat: remove single-run lock from review service"
```

---

### Task 3: Add cancelRun to ProcessManager + cancel endpoint

**Files:**
- Modify: `server-ts/src/processManager.ts:29-78`
- Create: `server-ts/src/routes/runControls.ts`
- Modify: `server-ts/src/app.ts`

- [ ] **Step 1: Add public cancelRun method**

In `server-ts/src/processManager.ts`, add after the existing `killProcess` method:

```typescript
cancelRun(runId: string): boolean {
  const child = this.children.get(runId);
  if (!child) return false;
  this.killProcess(runId);
  return true;
}
```

- [ ] **Step 2: Create runControls router**

Create `server-ts/src/routes/runControls.ts`:

```typescript
import { Router } from 'express';
import type { AppState } from '../state.js';
import { ApiError } from '../errors.js';

export function runControlsRouter(state: AppState): Router {
  const router = Router();

  // Cancel a running agent
  router.post('/api/runs/:runId/cancel', (req, res) => {
    const { runId } = req.params;
    const run = state.db.getRun(runId);
    if (!run) throw ApiError.notFound('Run not found');
    if (run.status !== 'running') throw ApiError.conflict('Run is not active');

    const killed = state.processManager.cancelRun(runId);
    if (!killed) throw ApiError.conflict('Process not found — may have already exited');

    state.db.updateRunStatus(runId, 'failed');
    res.json({ ok: true });
  });

  // Resume a stopped/failed run
  router.post('/api/runs/:runId/resume', async (req, res, next) => {
    try {
      const { runId } = req.params;
      const run = state.db.getRun(runId);
      if (!run) throw ApiError.notFound('Run not found');
      if (run.status === 'running') throw ApiError.conflict('Run is already active');

      const task = state.db.getTask(run.task_id);
      if (!task) throw ApiError.notFound('Task not found');
      const repo = state.db.getRepo(task.repo_id);
      if (!repo) throw ApiError.notFound('Repo not found');

      // Import and call resumeRunInternal
      const { resumeRunInternal } = await import('../services/runService.js');
      const result = await resumeRunInternal(state, repo, task, run);
      res.status(202).json(result);
    } catch (err) { next(err); }
  });

  // List all active runs across all repos
  router.get('/api/runs/active', (_req, res) => {
    const runs = state.db.getActiveRuns();
    res.json(runs);
  });

  return router;
}
```

- [ ] **Step 3: Add getActiveRuns DB method**

In `server-ts/src/db/maintenance.ts` (or appropriate db file), add:

```typescript
Db.prototype.getActiveRuns = function (): any[] {
  const db = this.connect();
  return db.prepare(`
    SELECT r.id, r.task_id, r.status, r.created_at, r.branch_name,
           t.title as task_title, t.repo_id,
           rp.path as repo_path, rp.name as repo_name
    FROM runs r
    INNER JOIN tasks t ON t.id = r.task_id
    INNER JOIN repos rp ON rp.id = t.repo_id
    WHERE r.status = 'running'
    ORDER BY r.created_at DESC
  `).all();
};
```

Add to the `declare module` augmentation:
```typescript
getActiveRuns(): any[];
```

- [ ] **Step 4: Mount router in app.ts**

In `server-ts/src/app.ts`, import and mount:
```typescript
import { runControlsRouter } from './routes/runControls.js';
// ...
app.use(runControlsRouter(state));
```

- [ ] **Step 5: Verify server compiles**

Run: `npm run check:server`

- [ ] **Step 6: Commit**

```bash
git add server-ts/src/processManager.ts server-ts/src/routes/runControls.ts server-ts/src/db/maintenance.ts server-ts/src/app.ts
git commit -m "feat: add cancel/resume/active-list endpoints for parallel runs"
```

---

### Task 4: Add global WS events for run lifecycle

**Files:**
- Modify: `server-ts/src/websocket.ts`
- Modify: `server-ts/src/services/runService.ts`
- Modify: `server-ts/src/processManager.ts`

- [ ] **Step 1: Add global WS client tracking in websocket.ts**

Add a Set to track global WS subscribers and a broadcast function:

```typescript
const globalClients = new Set<WebSocket>();

export function broadcastGlobalEvent(event: {
  type: 'run_started' | 'run_finished' | 'run_cancelled';
  runId: string;
  taskId: string;
  repoId: string;
  taskTitle: string;
  status?: string;
}) {
  const msg = JSON.stringify(event);
  for (const ws of globalClients) {
    if (ws.readyState === ws.OPEN) ws.send(msg);
  }
}
```

Add a global WS route in `attachWebSocketHandler`:
```typescript
if (pathname === '/api/ws/global') {
  wss.handleUpgrade(req, socket, head, (ws) => {
    globalClients.add(ws);
    ws.on('close', () => globalClients.delete(ws));
  });
  return;
}
```

- [ ] **Step 2: Emit run_started in runService.ts**

After run is created in `startRunInternal`, add:
```typescript
import { broadcastGlobalEvent } from '../websocket.js';
// ... after run creation:
broadcastGlobalEvent({
  type: 'run_started',
  runId: run.id, taskId: task.id, repoId: repo.id, taskTitle: task.title,
});
```

- [ ] **Step 3: Emit run_finished/run_cancelled in processManager**

In the exit handler of `spawnExitMonitor`, after status is updated:
```typescript
import { broadcastGlobalEvent } from './websocket.js';
// ... on process exit:
broadcastGlobalEvent({
  type: 'run_finished',
  runId, taskId, repoId, taskTitle,
  status: exitCode === 0 ? 'done' : 'failed',
});
```

In `cancelRun`:
```typescript
broadcastGlobalEvent({
  type: 'run_cancelled',
  runId, taskId, repoId, taskTitle,
});
```

Note: `spawnExitMonitor` may not have task/repo info — pass it through when registering, or look up from DB.

- [ ] **Step 4: Verify server compiles**

Run: `npm run check:server`

- [ ] **Step 5: Commit**

```bash
git add server-ts/src/websocket.ts server-ts/src/services/runService.ts server-ts/src/processManager.ts
git commit -m "feat: add global WebSocket events for run lifecycle"
```

---

## Chunk 2: Frontend — StatusBar + Global Runs

### Task 5: Add types for global runs and toasts

**Files:**
- Modify: `web/src/types.ts`

- [ ] **Step 1: Add new types**

In `web/src/types.ts`, add:

```typescript
export interface GlobalActiveRun {
  runId: string;
  taskId: string;
  repoId: string;
  repoName: string;
  taskTitle: string;
  status: 'running' | 'done' | 'failed' | 'cancelled';
  startedAt: string;
}

export interface ToastMessage {
  id: string;
  type: 'success' | 'error' | 'info';
  title: string;
  taskId: string;
  repoId: string;
  dismissedAt?: number;
}
```

- [ ] **Step 2: Commit**

```bash
git add web/src/types.ts
git commit -m "feat: add GlobalActiveRun and ToastMessage types"
```

---

### Task 6: Create useGlobalRuns hook

**Files:**
- Create: `web/src/hooks/useGlobalRuns.ts`

- [ ] **Step 1: Create the hook**

```typescript
import { useState, useEffect, useCallback, useRef } from 'react';
import type { GlobalActiveRun } from '../types';
import { api } from './useRunState'; // or wherever api helper lives

export function useGlobalRuns() {
  const [activeRuns, setActiveRuns] = useState<GlobalActiveRun[]>([]);
  const [seenByUser, setSeenByUser] = useState<Set<string>>(new Set());
  const wsRef = useRef<WebSocket | null>(null);

  // Fetch initial active runs
  useEffect(() => {
    api('/api/runs/active').then((runs: any[]) => {
      setActiveRuns(runs.map(r => ({
        runId: r.id,
        taskId: r.task_id,
        repoId: r.repo_id,
        repoName: r.repo_name,
        taskTitle: r.task_title,
        status: 'running' as const,
        startedAt: r.created_at,
      })));
    });
  }, []);

  // Connect to global WS
  useEffect(() => {
    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${protocol}//${location.host}/api/ws/global`);
    wsRef.current = ws;

    ws.onmessage = (e) => {
      const event = JSON.parse(e.data);
      if (event.type === 'run_started') {
        setActiveRuns(prev => [...prev, {
          runId: event.runId,
          taskId: event.taskId,
          repoId: event.repoId,
          repoName: event.repoName || '',
          taskTitle: event.taskTitle,
          status: 'running',
          startedAt: new Date().toISOString(),
        }]);
      } else if (event.type === 'run_finished' || event.type === 'run_cancelled') {
        setActiveRuns(prev => prev.map(r =>
          r.runId === event.runId
            ? { ...r, status: event.type === 'run_cancelled' ? 'cancelled' : event.status }
            : r
        ));
      }
    };

    ws.onclose = () => {
      // Reconnect after 2s
      setTimeout(() => wsRef.current === ws && setActiveRuns([]), 2000);
    };

    return () => { ws.close(); wsRef.current = null; };
  }, []);

  const markSeen = useCallback((runId: string) => {
    setSeenByUser(prev => new Set(prev).add(runId));
    setActiveRuns(prev => prev.filter(r =>
      r.runId === runId ? r.status === 'running' : true
    ));
  }, []);

  const cancelRun = useCallback(async (runId: string) => {
    await fetch(`/api/runs/${runId}/cancel`, { method: 'POST' });
  }, []);

  const resumeRun = useCallback(async (runId: string) => {
    await fetch(`/api/runs/${runId}/resume`, { method: 'POST' });
  }, []);

  // Runs visible in StatusBar: running + completed-but-unseen
  const visibleRuns = activeRuns.filter(r =>
    r.status === 'running' || r.status === 'cancelled' || !seenByUser.has(r.runId)
  );

  // Unseen finished runs (for toast)
  const unseenFinished = activeRuns.filter(r =>
    (r.status === 'done' || r.status === 'failed') && !seenByUser.has(r.runId)
  );

  return { visibleRuns, unseenFinished, cancelRun, resumeRun, markSeen };
}
```

- [ ] **Step 2: Commit**

```bash
git add web/src/hooks/useGlobalRuns.ts
git commit -m "feat: add useGlobalRuns hook with global WS subscription"
```

---

### Task 7: Create StatusBar component

**Files:**
- Create: `web/src/components/StatusBar.tsx`

- [ ] **Step 1: Create StatusBar**

```tsx
import type { GlobalActiveRun } from '../types';

interface Props {
  runs: GlobalActiveRun[];
  onCancel: (runId: string) => void;
  onResume: (runId: string) => void;
  onNavigate: (taskId: string, repoId: string) => void;
}

export function StatusBar({ runs, onCancel, onResume, onNavigate }: Props) {
  if (runs.length === 0) return null;

  return (
    <div className="fixed bottom-0 left-0 right-0 z-50 border-t border-zinc-700 bg-zinc-900 text-sm">
      <div className="flex flex-wrap gap-1 px-3 py-1.5">
        {runs.map(run => (
          <div
            key={run.runId}
            className="flex items-center gap-2 rounded px-2 py-1 hover:bg-zinc-800 cursor-pointer"
            onClick={() => onNavigate(run.taskId, run.repoId)}
          >
            {/* Icon */}
            {run.status === 'running' && (
              <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-blue-400 border-t-transparent" />
            )}
            {run.status === 'done' && (
              <span className="text-green-400">✓</span>
            )}
            {run.status === 'failed' && (
              <span className="text-red-400">✗</span>
            )}
            {run.status === 'cancelled' && (
              <span className="text-zinc-400">⏸</span>
            )}

            {/* Task info */}
            <span className="text-zinc-300 truncate max-w-48">{run.taskTitle}</span>
            <span className="text-zinc-500 text-xs">{run.repoName}</span>

            {/* Controls */}
            {run.status === 'running' && (
              <button
                className="ml-1 rounded px-1.5 py-0.5 text-xs text-red-400 hover:bg-red-400/10"
                onClick={(e) => { e.stopPropagation(); onCancel(run.runId); }}
              >
                Cancel
              </button>
            )}
            {(run.status === 'cancelled' || run.status === 'failed') && (
              <button
                className="ml-1 rounded px-1.5 py-0.5 text-xs text-blue-400 hover:bg-blue-400/10"
                onClick={(e) => { e.stopPropagation(); onResume(run.runId); }}
              >
                Resume
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add web/src/components/StatusBar.tsx
git commit -m "feat: add StatusBar component for parallel run monitoring"
```

---

### Task 8: Create toast notification system

**Files:**
- Create: `web/src/hooks/useToast.ts`
- Create: `web/src/components/ToastNotification.tsx`

- [ ] **Step 1: Create useToast hook**

```typescript
import { useState, useCallback } from 'react';
import type { ToastMessage } from '../types';

export function useToast() {
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  const addToast = useCallback((toast: Omit<ToastMessage, 'id'>) => {
    const id = crypto.randomUUID();
    setToasts(prev => [...prev, { ...toast, id }]);
    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id));
    }, 5000);
  }, []);

  const dismissToast = useCallback((id: string) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  }, []);

  return { toasts, addToast, dismissToast };
}
```

- [ ] **Step 2: Create ToastNotification component**

```tsx
import type { ToastMessage } from '../types';

interface Props {
  toasts: ToastMessage[];
  onDismiss: (id: string) => void;
  onNavigate: (taskId: string, repoId: string) => void;
}

export function ToastNotification({ toasts, onDismiss, onNavigate }: Props) {
  if (toasts.length === 0) return null;

  return (
    <div className="fixed bottom-12 right-4 z-50 flex flex-col gap-2">
      {toasts.map(toast => (
        <div
          key={toast.id}
          className="flex items-center gap-2 rounded-lg border border-zinc-700 bg-zinc-800 px-4 py-3 shadow-lg cursor-pointer"
          onClick={() => { onNavigate(toast.taskId, toast.repoId); onDismiss(toast.id); }}
        >
          <span>{toast.type === 'success' ? '✓' : '✗'}</span>
          <span className="text-sm text-zinc-200">{toast.title}</span>
          <button
            className="ml-2 text-zinc-500 hover:text-zinc-300"
            onClick={(e) => { e.stopPropagation(); onDismiss(toast.id); }}
          >×</button>
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add web/src/hooks/useToast.ts web/src/components/ToastNotification.tsx
git commit -m "feat: add toast notification system for background run completion"
```

---

### Task 9: Wire StatusBar + Toasts into App.tsx

**Files:**
- Modify: `web/src/App.tsx`

- [ ] **Step 1: Import and integrate**

Add imports:
```typescript
import { StatusBar } from './components/StatusBar';
import { ToastNotification } from './components/ToastNotification';
import { useGlobalRuns } from './hooks/useGlobalRuns';
import { useToast } from './hooks/useToast';
```

Inside the component, add hooks:
```typescript
const { visibleRuns, unseenFinished, cancelRun, resumeRun, markSeen } = useGlobalRuns();
const { toasts, addToast, dismissToast } = useToast();
```

Add effect for toasts from unseenFinished:
```typescript
useEffect(() => {
  for (const run of unseenFinished) {
    addToast({
      type: run.status === 'done' ? 'success' : 'error',
      title: `${run.taskTitle} ${run.status === 'done' ? 'tamamlandı' : 'başarısız'}`,
      taskId: run.taskId,
      repoId: run.repoId,
    });
    markSeen(run.runId);
  }
}, [unseenFinished]);
```

Add `onNavigate` handler:
```typescript
const handleRunNavigate = (taskId: string, repoId: string) => {
  // Switch repo if needed, then select task and open drawer
  if (repoId !== selectedRepoId) {
    setSelectedRepoId(repoId);
  }
  setSelectedTaskId(taskId);
  setShowDetails(true);
  markSeen(/* find runId for taskId */);
};
```

Add to JSX, after the main layout closing div:
```tsx
<StatusBar
  runs={visibleRuns}
  onCancel={cancelRun}
  onResume={resumeRun}
  onNavigate={handleRunNavigate}
/>
<ToastNotification
  toasts={toasts}
  onDismiss={dismissToast}
  onNavigate={handleRunNavigate}
/>
```

- [ ] **Step 2: Verify frontend builds**

Run: `cd /Users/melih/Documents/code/idea/web && npx eslint . && cd .. && npm run build`

- [ ] **Step 3: Commit**

```bash
git add web/src/App.tsx
git commit -m "feat: wire StatusBar and toast notifications into App"
```

---

## Chunk 3: Conflict-Resolving Merge

### Task 10: Create conflictResolverService

**Files:**
- Create: `server-ts/src/services/conflictResolverService.ts`

- [ ] **Step 1: Create the service**

```typescript
import type { AppState } from '../state.js';
import type { Task, Repo } from '../models.js';
import { spawnRunAgent } from './runAgent.js';
import { MsgStore } from '../msgStore.js';
import { broadcastGlobalEvent } from '../websocket.js';

export async function resolveConflicts(
  state: AppState,
  repo: Repo,
  task: Task,
  conflictedFiles: string[],
): Promise<{ runId: string }> {
  const runId = crypto.randomUUID();
  const store = new MsgStore();
  state.processManager.registerStore(runId, store);

  const prompt = buildConflictPrompt(conflictedFiles);

  // Create a run record for tracking
  state.db.createRun({
    id: runId,
    task_id: task.id,
    status: 'running',
    branch_name: task.branch_name || 'main',
    run_type: 'conflict_resolution',
  });

  broadcastGlobalEvent({
    type: 'run_started',
    runId, taskId: task.id, repoId: repo.id, taskTitle: `Conflict resolution: ${task.title}`,
  });

  // Spawn agent in the repo working directory (where conflicts exist)
  setImmediate(() => {
    spawnRunAgent(state, {
      runId,
      task,
      repo,
      store,
      prompt,
      useWorktree: false, // conflicts are in the current tree
    });
  });

  return { runId };
}

function buildConflictPrompt(files: string[]): string {
  return `You are resolving git merge conflicts. The following files have conflict markers:

${files.map(f => `- ${f}`).join('\n')}

Rules:
1. Open each conflicted file and resolve the conflicts
2. PRESERVE changes from BOTH sides — both branches contain critical work
3. Remove all conflict markers: <<<<<<<, =======, >>>>>>>
4. Produce the correct merged result that incorporates both sides' intent
5. Do NOT run git add or git commit — leave files as unstaged changes
6. If a conflict is ambiguous, prefer including both changes rather than losing either`;
}
```

- [ ] **Step 2: Add route endpoint**

In `server-ts/src/routes/runControls.ts`, add:

```typescript
// Resolve merge conflicts with agent
router.post('/api/tasks/:taskId/resolve-conflicts', async (req, res, next) => {
  try {
    const { taskId } = req.params;
    const { conflictedFiles } = req.body;
    const task = state.db.getTask(taskId);
    if (!task) throw ApiError.notFound('Task not found');
    const repo = state.db.getRepo(task.repo_id);
    if (!repo) throw ApiError.notFound('Repo not found');

    const { resolveConflicts } = await import('../services/conflictResolverService.js');
    const result = await resolveConflicts(state, repo, task, conflictedFiles);
    res.status(202).json(result);
  } catch (err) { next(err); }
});
```

- [ ] **Step 3: Verify server compiles**

Run: `npm run check:server`

- [ ] **Step 4: Commit**

```bash
git add server-ts/src/services/conflictResolverService.ts server-ts/src/routes/runControls.ts
git commit -m "feat: add agent-assisted conflict resolution service"
```

---

### Task 11: Add conflict resolution UI to DiffReviewPanel

**Files:**
- Modify: `web/src/components/DiffReviewPanel.tsx`

- [ ] **Step 1: Add conflict resolution buttons**

In DiffReviewPanel, find where conflict info is displayed (after merge returns `conflict: { conflictedFiles }`). Add two buttons:

```tsx
{conflictInfo && (
  <div className="flex items-center gap-2 rounded border border-yellow-700 bg-yellow-900/20 px-3 py-2">
    <span className="text-sm text-yellow-300">
      {conflictInfo.conflictedFiles.length} dosyada conflict var
    </span>
    <button
      className="rounded bg-blue-600 px-3 py-1 text-sm text-white hover:bg-blue-500"
      onClick={() => onResolveConflicts('agent', conflictInfo.conflictedFiles)}
    >
      Agent Çözsün
    </button>
    <button
      className="rounded border border-zinc-600 px-3 py-1 text-sm text-zinc-300 hover:bg-zinc-700"
      onClick={() => onResolveConflicts('manual', conflictInfo.conflictedFiles)}
    >
      Manuel Çözeceğim
    </button>
  </div>
)}
```

Add `onResolveConflicts` prop:
```typescript
onResolveConflicts: (mode: 'agent' | 'manual', files: string[]) => void;
```

- [ ] **Step 2: Wire in parent hook (useReviewState)**

In `useReviewState.ts`, add handler:
```typescript
const resolveConflicts = async (mode: 'agent' | 'manual', files: string[]) => {
  if (mode === 'manual') return; // existing behavior — user handles it
  const res = await api(`/api/tasks/${taskId}/resolve-conflicts`, {
    method: 'POST',
    body: JSON.stringify({ conflictedFiles: files }),
  });
  // Track the conflict resolution run like any other run
  if (res.runId) {
    onRunStarted(res.runId, taskId);
  }
};
```

- [ ] **Step 3: Verify frontend builds**

Run: `cd web && npx eslint . && cd .. && npm run build`

- [ ] **Step 4: Commit**

```bash
git add web/src/components/DiffReviewPanel.tsx web/src/hooks/useReviewState.ts
git commit -m "feat: add conflict resolution UI with agent/manual options"
```

---

## Execution Summary

| Chunk | Tasks | Can parallelize? |
|-------|-------|-----------------|
| **Chunk 1: Backend** | Tasks 1-4 | Tasks 1+2 parallel, then 3, then 4 |
| **Chunk 2: Frontend** | Tasks 5-9 | Tasks 5+6+7+8 parallel, then 9 |
| **Chunk 3: Conflict** | Tasks 10-11 | Task 10 then 11 (11 depends on 10's endpoint) |

**Subagent model recommendations:**
- Tasks 1, 2, 5: **haiku** — simple deletions/additions, minimal logic
- Tasks 3, 6, 7, 8, 10: **sonnet** — new files with moderate logic
- Tasks 4, 9, 11: **sonnet** — wiring across multiple files, need context awareness
