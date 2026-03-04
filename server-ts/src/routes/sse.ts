import type { Response } from 'express';

import type { MsgStore } from '../msgStore.js';
import type { AppState } from '../state.js';

// Re-export WebSocket helpers for consumers (main.ts imports from here)
export { handleStoreWS, handleWaitWS, sendBatchWS } from './wsHelpers.js';

const SSE_HEADERS = {
  'Content-Type': 'text/event-stream',
  'Cache-Control': 'no-cache',
  'Connection': 'keep-alive',
} as const;

function sseWrite(res: Response, data: string): boolean {
  try {
    return res.write(`data: ${data}\n\n`);
  } catch {
    return false;
  }
}

function sseEnd(res: Response): void {
  try { res.end(); } catch { /* already closed */ }
}

export function streamSSE(
  res: Response,
  handler: (send: (data: string) => void) => Promise<void>,
): void {
  res.writeHead(200, SSE_HEADERS);

  function send(data: string): void {
    sseWrite(res, data);
  }

  handler(send)
    .catch((err) => {
      send(JSON.stringify({ type: 'error', message: String(err) }));
    })
    .finally(() => {
      sseEnd(res);
    });
}

export function streamStoreAsSSE(res: Response, store: MsgStore): void {
  res.writeHead(200, SSE_HEADERS);

  const history = store.getHistory();
  for (const msg of history) {
    if (!sseWrite(res, JSON.stringify(msg))) return;
    if (msg.type === 'finished') {
      sseEnd(res);
      return;
    }
  }

  const unsubscribe = store.subscribe((msg) => {
    if (!sseWrite(res, JSON.stringify(msg))) {
      unsubscribe();
      return;
    }
    if (msg.type === 'finished') {
      unsubscribe();
      sseEnd(res);
    }
  });
}

export function waitForStoreSSE(
  res: Response,
  state: AppState,
  storeKey: string,
  isPlan: boolean,
): void {
  const statusMsg = isPlan
    ? 'Waiting for plan output...'
    : 'Run is starting. Waiting for agent stream...';

  res.writeHead(200, SSE_HEADERS);

  if (!sseWrite(res, JSON.stringify({
    type: 'db_event',
    data: JSON.stringify({ type: 'status', payload: { message: statusMsg } }),
  }))) {
    sseEnd(res);
    return;
  }

  (async () => {
    for (let i = 0; i < 120; i++) {
      await new Promise((resolve) => setTimeout(resolve, 500));
      const store = state.processManager.getStore(storeKey);
      if (store) {
        const history = store.getHistory();
        for (const msg of history) {
          if (!sseWrite(res, JSON.stringify(msg))) {
            sseEnd(res);
            return;
          }
          if (msg.type === 'finished') {
            sseEnd(res);
            return;
          }
        }

        await new Promise<void>((resolve) => {
          const unsubscribe = store.subscribe((msg) => {
            if (!sseWrite(res, JSON.stringify(msg))) {
              unsubscribe();
              resolve();
              return;
            }
            if (msg.type === 'finished') {
              unsubscribe();
              resolve();
            }
          });
        });
        sseEnd(res);
        return;
      }
    }

    sseEnd(res);
  })();
}

export function streamSSEBatch(res: Response, messages: string[]): void {
  res.writeHead(200, SSE_HEADERS);
  for (const msg of messages) {
    if (!sseWrite(res, msg)) return;
  }
  sseEnd(res);
}
