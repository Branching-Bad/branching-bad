import type { IncomingMessage, Server } from 'http';
import type { Duplex } from 'stream';
import { WebSocketServer } from 'ws';

import { planStoreKey } from './routes/shared.js';
import {
  handleStoreWS,
  handleWaitWS,
  sendBatchWS,
} from './routes/sse.js';
import type { AppState } from './state.js';

/**
 * Attach a WebSocket upgrade handler to the given HTTP server.
 * Routes:
 *   /api/plans/jobs/:job_id/ws  — plan job streaming
 *   /api/runs/:run_id/ws        — run streaming
 */
export function attachWebSocketHandler(server: Server, state: AppState): void {
  const wss = new WebSocketServer({ noServer: true });

  server.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url ?? '', `http://${req.headers.host}`);
    const pathname = url.pathname;

    const planWsMatch = pathname.match(/^\/api\/plans\/jobs\/([^/]+)\/ws$/);
    if (planWsMatch) {
      handlePlanJobUpgrade(wss, req, socket, head, planWsMatch[1], state);
      return;
    }

    const runWsMatch = pathname.match(/^\/api\/runs\/([^/]+)\/ws$/);
    if (runWsMatch) {
      handleRunUpgrade(wss, req, socket, head, runWsMatch[1], state);
      return;
    }

    // No matching WS route — destroy the socket
    socket.destroy();
  });
}

function handlePlanJobUpgrade(
  wss: WebSocketServer,
  req: IncomingMessage,
  socket: Duplex,
  head: Buffer,
  jobId: string,
  state: AppState,
): void {
  wss.handleUpgrade(req, socket, head, (ws) => {
    const job = state.db.getPlanJobById(jobId);
    if (!job) {
      ws.close(4004, 'Plan job not found');
      return;
    }

    const storeKey = planStoreKey(jobId);
    const store = state.processManager.getStore(storeKey);

    if (store) {
      handleStoreWS(ws, store);
      return;
    }

    if (job.status === 'running' || job.status === 'pending') {
      handleWaitWS(ws, state, storeKey, true);
      return;
    }

    // Job is done or failed: return historical messages
    const messages: string[] = [];
    messages.push(JSON.stringify({
      type: 'db_event',
      data: JSON.stringify({ type: 'status', payload: { message: `Plan job status: ${job.status}` } }),
    }));
    if (job.error) {
      messages.push(JSON.stringify({ type: 'stderr', data: job.error }));
    }
    messages.push(JSON.stringify({
      type: 'finished',
      data: JSON.stringify({ exitCode: job.status === 'done' ? 0 : null, status: job.status }),
    }));
    sendBatchWS(ws, messages);
  });
}

function handleRunUpgrade(
  wss: WebSocketServer,
  req: IncomingMessage,
  socket: Duplex,
  head: Buffer,
  runId: string,
  state: AppState,
): void {
  wss.handleUpgrade(req, socket, head, (ws) => {
    const run = state.db.getRunById(runId);
    if (!run) {
      ws.close(4004, 'Run not found');
      return;
    }

    const store = state.processManager.getStore(runId);
    if (store) {
      handleStoreWS(ws, store);
      return;
    }

    if (run.status === 'running') {
      handleWaitWS(ws, state, runId, false);
      return;
    }

    // Completed run: send historical events
    const events = state.db.listRunEvents(runId);
    const messages: string[] = events.map((e) =>
      JSON.stringify({
        type: 'db_event',
        data: JSON.stringify({ type: e.type, payload: e.payload }),
      }),
    );
    messages.push(
      JSON.stringify({
        type: 'finished',
        data: JSON.stringify({ exitCode: run.exit_code, status: run.status }),
      }),
    );
    sendBatchWS(ws, messages);
  });
}
