import * as net from 'node:net';
import type { SshManager } from './sshManager.js';
import type { SshForward, SshForwardStatus } from './types.js';

interface ActiveLocal {
  server: net.Server;
  forwardId: string;
  type: 'local';
}

interface ActiveRemote {
  forwardId: string;
  type: 'remote';
  bindAddress: string;
  bindPort: number;
}

export function createForwardManager({ ssh }: { ssh: SshManager }) {
  const bySession = new Map<string, { active: (ActiveLocal | ActiveRemote)[]; errors: Map<string, string> }>();

  function getState(sessionId: string) {
    let s = bySession.get(sessionId);
    if (!s) { s = { active: [], errors: new Map() }; bySession.set(sessionId, s); }
    return s;
  }

  async function activate(sessionId: string, fwd: SshForward): Promise<void> {
    const session = ssh.get(sessionId);
    if (!session) throw new Error('FORWARD_FAILED: session not found');
    const state = getState(sessionId);

    if (fwd.forwardType === 'local') {
      const server = net.createServer((local) => {
        session.client.forwardOut(
          fwd.bindAddress, fwd.bindPort, fwd.remoteHost, fwd.remotePort,
          (err, remote) => {
            if (err) { local.destroy(err); return; }
            local.pipe(remote).pipe(local);
          },
        );
      });
      await new Promise<void>((resolve, reject) => {
        server.once('error', (e) => reject(new Error('FORWARD_FAILED: ' + e.message)));
        server.listen(fwd.bindPort, fwd.bindAddress, () => resolve());
      });
      state.active.push({ server, forwardId: fwd.id, type: 'local' });
    } else {
      await new Promise<void>((resolve, reject) => {
        session.client.forwardIn(fwd.bindAddress, fwd.bindPort, (err) => {
          if (err) reject(new Error('FORWARD_FAILED: ' + err.message));
          else resolve();
        });
      });
      const routes = wireRemoteRouter(session.client, sessionId);
      routes.set(fwd.bindPort, { host: fwd.remoteHost, port: fwd.remotePort });
      state.active.push({ forwardId: fwd.id, type: 'remote', bindAddress: fwd.bindAddress, bindPort: fwd.bindPort });
    }
  }

  function wireRemoteRouter(client: any, sessionId: string): Map<number, { host: string; port: number }> {
    if (client.__forwardInRoutes) return client.__forwardInRoutes as Map<number, { host: string; port: number }>;
    const routes = new Map<number, { host: string; port: number }>();
    client.__forwardInRoutes = routes;
    client.on('tcp connection', (info: { destPort: number }, accept: () => any) => {
      const route = routes.get(info.destPort);
      const stream = accept();
      if (!route) { stream.end(); return; }
      const target = net.connect(route.port, route.host, () => {
        stream.pipe(target).pipe(stream);
      });
      target.on('error', () => stream.end());
    });
    void sessionId;
    return routes;
  }

  async function deactivate(sessionId: string, forwardId: string): Promise<void> {
    const state = bySession.get(sessionId);
    if (!state) return;
    const idx = state.active.findIndex((a) => a.forwardId === forwardId);
    if (idx < 0) return;
    const entry = state.active[idx];
    if (entry.type === 'local') {
      await new Promise<void>((resolve) => entry.server.close(() => resolve()));
    } else {
      const session = ssh.get(sessionId);
      if (session) {
        const routes = (session.client as any).__forwardInRoutes as Map<number, unknown> | undefined;
        routes?.delete(entry.bindPort);
        await new Promise<void>((resolve) => session.client.unforwardIn(entry.bindAddress, entry.bindPort, () => resolve()));
      }
    }
    state.active.splice(idx, 1);
  }

  async function deactivateAll(sessionId: string): Promise<void> {
    const state = bySession.get(sessionId);
    if (!state) return;
    for (const entry of [...state.active]) {
      await deactivate(sessionId, entry.forwardId);
    }
    bySession.delete(sessionId);
  }

  function status(sessionId: string): SshForwardStatus[] {
    const state = bySession.get(sessionId);
    if (!state) return [];
    const out: SshForwardStatus[] = [];
    for (const entry of state.active) {
      out.push({ forwardId: entry.forwardId, state: 'active' });
    }
    for (const [id, msg] of state.errors) {
      out.push({ forwardId: id, state: 'error', message: msg });
    }
    return out;
  }

  function recordError(sessionId: string, forwardId: string, message: string): void {
    getState(sessionId).errors.set(forwardId, message);
  }

  return { activate, deactivate, deactivateAll, status, recordError };
}

export type ForwardManager = ReturnType<typeof createForwardManager>;
