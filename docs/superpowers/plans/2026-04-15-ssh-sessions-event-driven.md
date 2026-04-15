# SSH Sessions Event-Driven Refresh — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the 5-second polling loop in `useSshSessions` with push-based updates via the existing `/api/ws/global` WebSocket channel, eliminating all idle resource usage.

**Architecture:** The server broadcasts `ssh_sessions_changed` on the global WS channel whenever a session is created, destroyed, or drops unexpectedly. The frontend opens a WS connection and refreshes only on that signal plus `onopen` (which handles reconnects, page refreshes, and navigation). No timers anywhere.

**Tech Stack:** Node.js `ws` WebSocket server (already in use), React `useEffect` with `WebSocket` API.

---

## Files

| File | Change |
|---|---|
| `server-ts/src/websocket.ts` | Add `ssh_sessions_changed` to `GlobalEvent` union |
| `server-ts/src/ssh/sshManager.ts` | Add `onSessionClosed` callback to config; call on `close` |
| `server-ts/src/ssh/index.ts` | Pass `onSessionClosed` → `broadcastGlobalEvent` to `createSshManager` |
| `server-ts/src/routes/ssh.ts` | Call `broadcastGlobalEvent` after connect and disconnect |
| `web/src/hooks/useSshSessions.ts` | Remove `setInterval`; add WS listener with `onopen` + `onmessage` |

---

## Task 1: Add `ssh_sessions_changed` to `GlobalEvent`

**Files:**
- Modify: `server-ts/src/websocket.ts`

- [ ] **Step 1: Add event type**

In `server-ts/src/websocket.ts`, extend the `GlobalEvent` union (currently ends at line 36):

```ts
export type GlobalEvent =
  | {
      type: 'run_started' | 'run_finished' | 'run_cancelled';
      runId: string;
      taskId: string;
      repoId: string;
      taskTitle: string;
      repoName?: string;
      status?: string;
    }
  | {
      type: 'task_applied';
      taskId: string;
      strategy: string;
      committed: boolean;
      filesChanged: number;
    }
  | { type: 'ssh_sessions_changed' };
```

- [ ] **Step 2: Type-check**

```bash
npm run check:server
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add server-ts/src/websocket.ts
git commit -m "feat(ssh): add ssh_sessions_changed to GlobalEvent"
```

---

## Task 2: Add `onSessionClosed` callback to `sshManager`

**Files:**
- Modify: `server-ts/src/ssh/sshManager.ts`

- [ ] **Step 1: Add callback to config and call it on close**

`createSshManager` currently takes `{ hostKeys }`. Expand the parameter type and call the callback in the `close` handler.

Replace the function signature (line 48):
```ts
export function createSshManager({ hostKeys }: { hostKeys: HostKeyStore }) {
```
with:
```ts
export function createSshManager({
  hostKeys,
  onSessionClosed,
}: {
  hostKeys: HostKeyStore;
  onSessionClosed?: (sessionId: string) => void;
}) {
```

Replace the `client.on('close', ...)` handler (lines 136-139):
```ts
client.on('close', () => {
  sessions.delete(sessionId);
  session.bastion?.end();
  onSessionClosed?.(sessionId);
});
```

- [ ] **Step 2: Type-check**

```bash
npm run check:server
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add server-ts/src/ssh/sshManager.ts
git commit -m "feat(ssh): add onSessionClosed callback to sshManager"
```

---

## Task 3: Wire `onSessionClosed` broadcast in `ssh/index.ts`

**Files:**
- Modify: `server-ts/src/ssh/index.ts`

- [ ] **Step 1: Import `broadcastGlobalEvent` and pass callback**

Replace the entire `index.ts` content:

```ts
import type { Db } from '../db/index.js';
import { createHostKeyStore, type HostKeyStore } from './hostKeyStore.js';
import { createSshManager, type SshManager } from './sshManager.js';
import { createPtyManager, type PtyManager } from './ptyManager.js';
import { createForwardManager, type ForwardManager } from './forwardManager.js';
import { broadcastGlobalEvent } from '../websocket.js';

export interface SshModule {
  hostKeys: HostKeyStore;
  ssh: SshManager;
  pty: PtyManager;
  forwards: ForwardManager;
}

let singleton: SshModule | null = null;

export function getSshModule(db: Db): SshModule {
  if (singleton) return singleton;
  const hostKeys = createHostKeyStore(db);
  const ssh = createSshManager({
    hostKeys,
    onSessionClosed: () => broadcastGlobalEvent({ type: 'ssh_sessions_changed' }),
  });
  const pty = createPtyManager({ ssh });
  const forwards = createForwardManager({ ssh });
  singleton = { hostKeys, ssh, pty, forwards };
  return singleton;
}

export * from './types.js';
export { HostKeyPromptError, SshError } from './sshManager.js';
export { launchSystemTerminal } from './terminalLauncher.js';
export { exportAll, importAll } from './importExport.js';
export { detectSshmaster, importSshmaster } from './migration.js';
```

- [ ] **Step 2: Type-check**

```bash
npm run check:server
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add server-ts/src/ssh/index.ts
git commit -m "feat(ssh): wire onSessionClosed broadcast in ssh module"
```

---

## Task 4: Broadcast after connect and disconnect in routes

**Files:**
- Modify: `server-ts/src/routes/ssh.ts`

- [ ] **Step 1: Add import**

At the top of `server-ts/src/routes/ssh.ts`, add after the existing imports:

```ts
import { broadcastGlobalEvent } from '../websocket.js';
```

- [ ] **Step 2: Broadcast after successful connect**

In the `POST /api/ssh/connections/:id/connect` handler, after `res.json({ sessionId })` (currently line 146):

```ts
res.json({ sessionId });
broadcastGlobalEvent({ type: 'ssh_sessions_changed' });
```

- [ ] **Step 3: Broadcast after disconnect**

In the `DELETE /api/ssh/sessions/:sessionId` handler, after `res.json({ ok: true })` (currently line 168):

```ts
res.json({ ok: true });
broadcastGlobalEvent({ type: 'ssh_sessions_changed' });
```

- [ ] **Step 4: Type-check**

```bash
npm run check:server
```

Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add server-ts/src/routes/ssh.ts
git commit -m "feat(ssh): broadcast ssh_sessions_changed on connect and disconnect"
```

---

## Task 5: Replace polling with WS listener in `useSshSessions`

**Files:**
- Modify: `web/src/hooks/useSshSessions.ts`

- [ ] **Step 1: Replace the polling `useEffect`**

Current code (lines 19-23):
```ts
useEffect(() => {
  void refresh();
  const t = setInterval(refresh, 5000);
  return () => clearInterval(t);
}, [refresh]);
```

Replace with:
```ts
useEffect(() => {
  void refresh();
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const ws = new WebSocket(`${protocol}//${window.location.host}/api/ws/global`);
  ws.onopen = () => { void refresh(); };
  ws.onmessage = (ev) => {
    try {
      const msg = JSON.parse(ev.data as string) as { type: string };
      if (msg.type === 'ssh_sessions_changed') void refresh();
    } catch { /* ignore malformed frames */ }
  };
  return () => ws.close();
}, [refresh]);
```

- [ ] **Step 2: Full build (type-check frontend + backend)**

```bash
npm run build
```

Expected: no errors, build succeeds.

- [ ] **Step 3: Manual smoke test**

Start dev server: `npm run dev`

1. Open SSH view → confirm connections list loads
2. Connect to an SSH server → confirm session appears immediately (no delay)
3. Disconnect → confirm session disappears immediately
4. Navigate away and back → confirm session list is correct
5. Refresh the page → confirm session list is correct
6. Open browser devtools Network tab → confirm no `/api/ssh/sessions` requests firing every 5s

- [ ] **Step 4: Commit**

```bash
git add web/src/hooks/useSshSessions.ts
git commit -m "feat(ssh): replace polling with event-driven WS refresh"
```
