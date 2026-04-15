import * as crypto from 'node:crypto';
import type { SshManager } from './sshManager.js';

const SCROLLBACK_CAP = 256 * 1024;

interface Pty {
  sessionId: string;
  stream: any;
  buffer: Buffer;
  subscribers: Set<(data: string) => void>;
  closedSubscribers: Set<() => void>;
  closed: boolean;
}

export function createPtyManager({ ssh }: { ssh: SshManager }) {
  const ptys = new Map<string, Pty>();

  function appendBuffer(pty: Pty, chunk: Buffer) {
    if (chunk.length >= SCROLLBACK_CAP) {
      pty.buffer = chunk.subarray(chunk.length - SCROLLBACK_CAP);
      return;
    }
    const combined = Buffer.concat([pty.buffer, chunk]);
    if (combined.length > SCROLLBACK_CAP) {
      pty.buffer = combined.subarray(combined.length - SCROLLBACK_CAP);
    } else {
      pty.buffer = combined;
    }
  }

  async function openShell(sessionId: string, opts: { cols: number; rows: number }): Promise<{ ptyId: string }> {
    const session = ssh.get(sessionId);
    if (!session) throw new Error('PTY_OPEN_FAILED: session not found');

    const stream: any = await new Promise((resolve, reject) => {
      session.client.shell(
        { cols: opts.cols, rows: opts.rows, term: 'xterm-256color' } as any,
        (err, s) => (err ? reject(new Error('PTY_OPEN_FAILED: ' + err.message)) : resolve(s)),
      );
    });

    const ptyId = crypto.randomUUID();
    const pty: Pty = {
      sessionId,
      stream,
      buffer: Buffer.alloc(0),
      subscribers: new Set(),
      closedSubscribers: new Set(),
      closed: false,
    };
    ptys.set(ptyId, pty);

    stream.on('data', (d: Buffer) => {
      appendBuffer(pty, d);
      const s = d.toString('utf8');
      for (const sub of pty.subscribers) {
        try { sub(s); } catch {}
      }
    });
    stream.stderr?.on('data', (d: Buffer) => {
      appendBuffer(pty, d);
      const s = d.toString('utf8');
      for (const sub of pty.subscribers) {
        try { sub(s); } catch {}
      }
    });
    stream.on('close', () => {
      pty.closed = true;
      for (const sub of pty.closedSubscribers) {
        try { sub(); } catch {}
      }
      ptys.delete(ptyId);
    });

    return { ptyId };
  }

  function write(ptyId: string, data: string): void {
    const pty = ptys.get(ptyId);
    if (!pty || pty.closed) return;
    pty.stream.write(data);
  }

  function resize(ptyId: string, cols: number, rows: number): void {
    const pty = ptys.get(ptyId);
    if (!pty || pty.closed) return;
    pty.stream.setWindow(rows, cols, 0, 0);
  }

  function close(ptyId: string): void {
    const pty = ptys.get(ptyId);
    if (!pty || pty.closed) return;
    try { pty.stream.end(); } catch {}
  }

  function subscribe(
    ptyId: string,
    onData: (data: string) => void,
    onClose: () => void,
  ): () => void {
    const pty = ptys.get(ptyId);
    if (!pty) { onClose(); return () => {}; }
    if (pty.buffer.length > 0) {
      try { onData(pty.buffer.toString('utf8')); } catch {}
    }
    if (pty.closed) { onClose(); return () => {}; }
    pty.subscribers.add(onData);
    pty.closedSubscribers.add(onClose);
    return () => {
      pty.subscribers.delete(onData);
      pty.closedSubscribers.delete(onClose);
    };
  }

  function listForSession(sessionId: string): { ptyId: string }[] {
    const out: { ptyId: string }[] = [];
    for (const [id, p] of ptys) if (p.sessionId === sessionId) out.push({ ptyId: id });
    return out;
  }

  function closeAllForSession(sessionId: string): void {
    for (const [id, p] of ptys) if (p.sessionId === sessionId) {
      try { p.stream.end(); } catch {}
      ptys.delete(id);
    }
  }

  return { openShell, write, resize, close, subscribe, listForSession, closeAllForSession };
}

export type PtyManager = ReturnType<typeof createPtyManager>;
