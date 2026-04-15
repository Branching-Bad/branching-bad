import { Router, type Request, type Response } from 'express';
import type { AppState } from '../state.js';
import { ApiError } from '../errors.js';
import {
  getSshModule, HostKeyPromptError, SshError,
  launchSystemTerminal, exportAll, importAll, detectSshmaster, importSshmaster,
} from '../ssh/index.js';
import { encrypt, decrypt } from '../ssh/crypto.js';
import { broadcastGlobalEvent } from '../websocket.js';

export function sshRoutes(): Router {
  const router = Router();

  function mod(req: Request) {
    const state = req.app.locals.state as AppState;
    return getSshModule(state.db);
  }

  // ── Groups ───────────────────────────────────────────
  router.get('/api/ssh/groups', (req, res) => {
    const state = req.app.locals.state as AppState;
    res.json({ groups: state.db.listSshGroups() });
  });
  router.post('/api/ssh/groups', (req, res) => {
    const state = req.app.locals.state as AppState;
    const name = (req.body?.name as string | undefined)?.trim();
    if (!name) throw ApiError.badRequest('name required');
    res.json({ group: state.db.createSshGroup(name) });
  });
  router.patch('/api/ssh/groups/:id', (req, res) => {
    const state = req.app.locals.state as AppState;
    const name = (req.body?.name as string | undefined)?.trim();
    if (!name) throw ApiError.badRequest('name required');
    state.db.renameSshGroup(req.params.id, name);
    res.json({ ok: true });
  });
  router.delete('/api/ssh/groups/:id', (req, res) => {
    const state = req.app.locals.state as AppState;
    state.db.deleteSshGroup(req.params.id);
    res.json({ ok: true });
  });

  // ── Connections ─────────────────────────────────────
  router.get('/api/ssh/connections', (req, res) => {
    const state = req.app.locals.state as AppState;
    res.json({ connections: state.db.listSshConnections() });
  });

  router.post('/api/ssh/connections', (req, res) => {
    const state = req.app.locals.state as AppState;
    const b = req.body as any;
    validateConnectionInput(b, state.db);
    const passwordCipher = b.password ? encrypt(b.password) : null;
    const hasPassphrase = Boolean(b.passphrase);
    const passphraseCipher = b.passphrase ? encrypt(b.passphrase) : null;
    const conn = state.db.createSshConnection({
      alias: b.alias, groupId: b.groupId ?? null,
      host: b.host, port: Number(b.port) || 22, username: b.username,
      authType: b.authType, keyPath: b.keyPath ?? null,
      passwordCipher, hasPassphrase, passphraseCipher,
      jumpHostId: b.jumpHostId ?? null,
      forwards: b.forwards ?? [],
    });
    res.json({ connection: conn });
  });

  router.patch('/api/ssh/connections/:id', (req, res) => {
    const state = req.app.locals.state as AppState;
    const b = req.body as any;
    const patch: any = {};
    if ('alias' in b) patch.alias = b.alias;
    if ('groupId' in b) patch.groupId = b.groupId;
    if ('host' in b) patch.host = b.host;
    if ('port' in b) patch.port = Number(b.port) || 22;
    if ('username' in b) patch.username = b.username;
    if ('authType' in b) patch.authType = b.authType;
    if ('keyPath' in b) patch.keyPath = b.keyPath;
    if ('jumpHostId' in b) patch.jumpHostId = b.jumpHostId;
    if ('forwards' in b) patch.forwards = b.forwards;
    if (b.password !== undefined) patch.passwordCipher = b.password ? encrypt(b.password) : null;
    if (b.passphrase !== undefined) {
      patch.hasPassphrase = Boolean(b.passphrase);
      patch.passphraseCipher = b.passphrase ? encrypt(b.passphrase) : null;
    }
    validateJumpHost(req.params.id, patch.jumpHostId, state.db);
    const conn = state.db.updateSshConnection(req.params.id, patch);
    res.json({ connection: conn });
  });

  router.delete('/api/ssh/connections/:id', (req, res) => {
    const state = req.app.locals.state as AppState;
    state.db.deleteSshConnection(req.params.id);
    res.json({ ok: true });
  });

  function validateConnectionInput(b: any, db: AppState['db']): void {
    if (!b?.alias) throw ApiError.badRequest('alias required');
    if (!b?.host) throw ApiError.badRequest('host required');
    if (!b?.username) throw ApiError.badRequest('username required');
    const port = Number(b.port);
    if (!Number.isFinite(port) || port < 1 || port > 65535) throw ApiError.badRequest('port out of range');
    if (b.authType !== 'password' && b.authType !== 'key') throw ApiError.badRequest('invalid authType');
    validateJumpHost(null, b.jumpHostId ?? null, db);
  }

  function validateJumpHost(selfId: string | null, jumpHostId: string | null | undefined, db: AppState['db']): void {
    if (!jumpHostId) return;
    if (selfId && jumpHostId === selfId) throw ApiError.badRequest('connection cannot be its own jump host');
    const jump = db.getSshConnection(jumpHostId);
    if (!jump) throw ApiError.badRequest('jump host not found');
    if (jump.jumpHostId) throw ApiError.badRequest('multi-level jump hosts not supported');
  }

  // ── Sessions ────────────────────────────────────────
  router.post('/api/ssh/connections/:id/connect', async (req, res) => {
    const state = req.app.locals.state as AppState;
    const m = mod(req);
    const conn = state.db.getSshConnection(req.params.id);
    if (!conn) throw ApiError.notFound('connection not found');

    const ciphers = state.db.getSshConnectionCiphers(conn.id);
    const password = ciphers.password_cipher ? decrypt(ciphers.password_cipher) ?? undefined : undefined;
    const passphrase = ciphers.passphrase_cipher ? decrypt(ciphers.passphrase_cipher) ?? undefined : undefined;

    let jumpHost: typeof conn | undefined;
    let jumpSecrets: any = undefined;
    if (conn.jumpHostId) {
      const jh = state.db.getSshConnection(conn.jumpHostId);
      if (!jh) throw ApiError.badRequest('jump host missing');
      jumpHost = jh;
      const jc = state.db.getSshConnectionCiphers(jh.id);
      jumpSecrets = {
        password: jc.password_cipher ? decrypt(jc.password_cipher) ?? undefined : undefined,
        passphrase: jc.passphrase_cipher ? decrypt(jc.passphrase_cipher) ?? undefined : undefined,
      };
    }

    const startedAt = new Date();
    try {
      const { sessionId } = await m.ssh.connect({ conn, password, passphrase, jumpHost, jumpHostSecrets: jumpSecrets });
      state.db.setSshConnectionLastConnected(conn.id, startedAt.toISOString());
      state.db.appendSshHistory({ connectionId: conn.id, attemptedAt: startedAt.toISOString(), status: 'connected', errorCode: null, durationSec: null });
      for (const f of conn.forwards) {
        try { await m.forwards.activate(sessionId, f); }
        catch (e: any) { m.forwards.recordError(sessionId, f.id, e.message); }
      }
      res.json({ sessionId });
      broadcastGlobalEvent({ type: 'ssh_sessions_changed' });
    } catch (e: any) {
      state.db.appendSshHistory({ connectionId: conn.id, attemptedAt: startedAt.toISOString(), status: 'failed', errorCode: e.code ?? 'UNKNOWN', durationSec: null });
      if (e instanceof HostKeyPromptError) {
        return res.status(409).json({
          error: 'HOST_KEY_PROMPT', host: e.host, port: e.port,
          fingerprint: e.fingerprint, kind: e.kind, expected: e.expected,
        });
      }
      if (e instanceof SshError) {
        return res.status(400).json({ error: e.code, message: e.message });
      }
      throw e;
    }
  });

  router.delete('/api/ssh/sessions/:sessionId', async (req, res) => {
    const m = mod(req);
    await m.forwards.deactivateAll(req.params.sessionId);
    m.pty.closeAllForSession(req.params.sessionId);
    await m.ssh.disconnect(req.params.sessionId);
    res.json({ ok: true });
    broadcastGlobalEvent({ type: 'ssh_sessions_changed' });
  });

  router.get('/api/ssh/sessions', (req, res) => {
    const m = mod(req);
    const sessions = m.ssh.list().map((s) => ({
      ...s,
      ptys: m.pty.listForSession(s.sessionId).map((p) => p.ptyId),
    }));
    res.json({ sessions });
  });

  router.post('/api/ssh/sessions/:sessionId/pty', async (req, res) => {
    const m = mod(req);
    const cols = Number(req.body?.cols) || 80;
    const rows = Number(req.body?.rows) || 24;
    const { ptyId } = await m.pty.openShell(req.params.sessionId, { cols, rows });
    res.json({ ptyId });
  });

  router.delete('/api/ssh/ptys/:ptyId', (req, res) => {
    const m = mod(req);
    m.pty.close(req.params.ptyId);
    res.json({ ok: true });
  });

  router.get('/api/ssh/sessions/:sessionId/forwards', (req, res) => {
    const m = mod(req);
    res.json({ status: m.forwards.status(req.params.sessionId) });
  });

  router.post('/api/ssh/connections/:id/launch-terminal', (req, res) => {
    const state = req.app.locals.state as AppState;
    const conn = state.db.getSshConnection(req.params.id);
    if (!conn) throw ApiError.notFound('connection not found');
    const jump = conn.jumpHostId ? state.db.getSshConnection(conn.jumpHostId) : null;
    try {
      launchSystemTerminal(conn, jump);
      res.json({ ok: true });
    } catch (e: any) {
      res.status(500).json({ error: e.code ?? 'LAUNCH_FAILED', message: e.message });
    }
  });

  // ── Known hosts ─────────────────────────────────────
  router.get('/api/ssh/known-hosts', (req, res) => {
    const m = mod(req);
    res.json({ hosts: m.hostKeys.list() });
  });
  router.post('/api/ssh/known-hosts', (req, res) => {
    const m = mod(req);
    const { host, port, fingerprint } = req.body ?? {};
    if (!host || !port || !fingerprint) throw ApiError.badRequest('host, port, fingerprint required');
    m.hostKeys.approve(host, Number(port), fingerprint);
    res.json({ ok: true });
  });
  router.delete('/api/ssh/known-hosts/:host/:port', (req, res) => {
    const m = mod(req);
    m.hostKeys.delete(req.params.host, Number(req.params.port));
    res.json({ ok: true });
  });

  // ── History ─────────────────────────────────────────
  router.get('/api/ssh/history', (req, res) => {
    const state = req.app.locals.state as AppState;
    const limit = Math.min(Number(req.query.limit) || 50, 500);
    res.json({ history: state.db.listSshHistory(limit) });
  });

  // ── Import / export ────────────────────────────────
  router.get('/api/ssh/export', (req, res) => {
    const state = req.app.locals.state as AppState;
    res.json(exportAll(state.db));
  });
  router.post('/api/ssh/import', (req, res) => {
    const state = req.app.locals.state as AppState;
    const strategy = (req.query.strategy === 'update' ? 'update' : 'skip');
    const report = importAll(state.db, req.body, strategy);
    res.json(report);
  });

  // ── Sshmaster migration ────────────────────────────
  router.get('/api/ssh/migration/sshmaster', (req, res) => {
    const state = req.app.locals.state as AppState;
    const dismissed = state.db.getSshKv('sshmaster_migration_dismissed') === '1';
    const detected = detectSshmaster();
    res.json({ available: Boolean(detected) && !dismissed, path: detected });
  });
  router.post('/api/ssh/migration/sshmaster', (req, res) => {
    const state = req.app.locals.state as AppState;
    const report = importSshmaster(state.db);
    state.db.setSshKv('sshmaster_migration_dismissed', '1');
    res.json(report);
  });
  router.post('/api/ssh/migration/sshmaster/dismiss', (req, res) => {
    const state = req.app.locals.state as AppState;
    state.db.setSshKv('sshmaster_migration_dismissed', '1');
    res.json({ ok: true });
  });

  return router;
}
