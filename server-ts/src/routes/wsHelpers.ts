import type { WebSocket } from 'ws';

import type { MsgStore } from '../msgStore.js';
import type { AppState } from '../state.js';

function wsSend(ws: WebSocket, data: string): boolean {
  try {
    if (ws.readyState === ws.OPEN) {
      ws.send(data);
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

export function handleStoreWS(ws: WebSocket, store: MsgStore): void {
  const history = store.getHistory();
  for (const msg of history) {
    if (!wsSend(ws, JSON.stringify(msg))) return;
    if (msg.type === 'finished') {
      ws.close();
      return;
    }
  }

  const unsubscribe = store.subscribe((msg) => {
    if (!wsSend(ws, JSON.stringify(msg))) {
      unsubscribe();
      return;
    }
    if (msg.type === 'finished') {
      unsubscribe();
      ws.close();
    }
  });

  ws.on('close', () => unsubscribe());
}

export function handleWaitWS(
  ws: WebSocket,
  state: AppState,
  storeKey: string,
  isPlan: boolean,
): void {
  const statusMsg = isPlan
    ? 'Waiting for plan output...'
    : 'Run is starting. Waiting for agent stream...';

  wsSend(ws, JSON.stringify({
    type: 'db_event',
    data: JSON.stringify({ type: 'status', payload: { message: statusMsg } }),
  }));

  (async () => {
    for (let i = 0; i < 120; i++) {
      await new Promise((resolve) => setTimeout(resolve, 500));
      if (ws.readyState !== ws.OPEN) return;

      const store = state.processManager.getStore(storeKey);
      if (store) {
        handleStoreWS(ws, store);
        return;
      }
    }
    ws.close();
  })();
}

export function sendBatchWS(ws: WebSocket, messages: string[]): void {
  for (const msg of messages) {
    if (!wsSend(ws, msg)) return;
  }
  ws.close();
}
