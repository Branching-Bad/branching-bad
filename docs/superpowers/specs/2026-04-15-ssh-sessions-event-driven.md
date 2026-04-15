# SSH Sessions — Event-Driven Refresh

**Date:** 2026-04-15

## Problem

`useSshSessions` polls `GET /api/ssh/sessions` every 5 seconds unconditionally. This
creates a constant HTTP round-trip even when there are no active SSH connections,
wasting CPU cycles, battery, and network resources.

## Solution

Replace polling with push-based updates via the existing `/api/ws/global` WebSocket
channel. The frontend refreshes session state only when the server signals a change.

## Scenarios Covered

| Event | How frontend learns |
|---|---|
| Connect succeeds | route broadcasts → WS event → refresh |
| Normal disconnect | route broadcasts → WS event → refresh |
| SSH connection drops (graceful) | `onSessionClosed` callback → broadcast → WS event → refresh |
| App crash / WS drop | WS reconnects → `onopen` → refresh |
| Page refresh | React remounts → WS connects → `onopen` → refresh |
| Navigate away & back | hook remounts → WS reconnects → `onopen` → refresh |

## Changes

### 1. `server-ts/src/websocket.ts`

Add `ssh_sessions_changed` to `GlobalEvent`:

```ts
| { type: 'ssh_sessions_changed' }
```

### 2. `server-ts/src/ssh/sshManager.ts`

Add `onSessionClosed?: (sessionId: string) => void` to `createSshManager` config.
Call it inside `client.on('close', ...)`:

```ts
client.on('close', () => {
  sessions.delete(sessionId);
  session.bastion?.end();
  options.onSessionClosed?.(sessionId);
});
```

### 3. `server-ts/src/ssh/index.ts`

Import `broadcastGlobalEvent` and pass `onSessionClosed` to `createSshManager`:

```ts
import { broadcastGlobalEvent } from '../websocket.js';

const ssh = createSshManager({
  hostKeys,
  onSessionClosed: () => broadcastGlobalEvent({ type: 'ssh_sessions_changed' }),
});
```

### 4. `server-ts/src/routes/ssh.ts`

Import `broadcastGlobalEvent` and call it after connect and disconnect:

- `POST /connections/:id/connect` — after `res.json({ sessionId })`
- `DELETE /sessions/:sessionId` — after `res.json({ ok: true })`

### 5. `web/src/hooks/useSshSessions.ts`

Remove `setInterval`. Replace with a WebSocket that:
- On `onopen` → calls `refresh()` (handles reconnects, page refreshes, navigation)
- On `message` where `type === 'ssh_sessions_changed'` → calls `refresh()`
- Cleans up on unmount

```ts
useEffect(() => {
  void refresh();
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const ws = new WebSocket(`${protocol}//${window.location.host}/api/ws/global`);
  ws.onopen = () => { void refresh(); };
  ws.onmessage = (ev) => {
    try {
      const msg = JSON.parse(ev.data as string);
      if (msg.type === 'ssh_sessions_changed') void refresh();
    } catch { /* ignore */ }
  };
  return () => ws.close();
}, [refresh]);
```

## What is NOT changed

- Server-side SSH code has no polling — `sshManager`, `forwardManager`, `ptyManager`
  are already fully event-driven.
- No fallback timer. The `onopen` refresh on WS reconnect replaces it.
- No new WS endpoints. Reuses the existing `/api/ws/global` channel.
