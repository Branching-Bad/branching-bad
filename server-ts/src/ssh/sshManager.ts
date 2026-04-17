import { Client, utils as sshUtils } from 'ssh2';
import * as fs from 'node:fs';
import * as crypto from 'node:crypto';
import type { SshConnection, SshSessionInfo } from './types.js';
import { fingerprintOf, type HostKeyStore, type HostKeyCheck } from './hostKeyStore.js';

export class HostKeyPromptError extends Error {
  constructor(
    public host: string,
    public port: number,
    public fingerprint: string,
    public kind: 'unknown' | 'mismatch',
    public expected?: string,
  ) {
    super(`HOST_KEY_PROMPT: ${host}:${port} ${kind}`);
    this.name = 'HostKeyPromptError';
  }
}

export class SshError extends Error {
  constructor(public code: string, message: string) { super(message); this.name = 'SshError'; }
}

function wrapError(err: any): SshError {
  const msg = String(err?.message ?? err);
  let code = 'UNKNOWN';
  if (/authentication/i.test(msg)) code = 'AUTH_FAILED';
  else if (/ENOTFOUND|ECONNREFUSED|EHOSTUNREACH|ETIMEDOUT/i.test(msg)) code = 'HOST_UNREACHABLE';
  else if (/Timed out/i.test(msg)) code = 'TIMEOUT';
  return new SshError(code, msg);
}

export interface ConnectInput {
  conn: SshConnection;
  password?: string;
  passphrase?: string;
  jumpHost?: SshConnection;
  jumpHostSecrets?: { password?: string; passphrase?: string };
}

interface Session {
  connectionId: string;
  client: Client;
  connectedAt: string;
  bastion?: Client;
}

export function createSshManager({
  hostKeys,
  onSessionClosed,
}: {
  hostKeys: HostKeyStore;
  onSessionClosed?: (sessionId: string) => void;
}) {
  const sessions = new Map<string, Session>();

  function buildAuth(conn: SshConnection, password?: string, passphrase?: string) {
    const opts: any = {
      host: conn.host, port: conn.port, username: conn.username, readyTimeout: 15000,
    };
    if (conn.authType === 'password') {
      if (password === undefined || password === '') {
        throw new SshError('AUTH_FAILED', 'Password not provided');
      }
      opts.password = password;
    } else {
      if (!conn.keyPath) throw new SshError('AUTH_FAILED', 'Key path not set');
      let keyData: Buffer;
      try {
        keyData = fs.readFileSync(conn.keyPath);
      } catch (e: any) {
        throw new SshError('KEY_READ_ERROR', `Cannot read key file: ${e.message}`);
      }
      const parsed = sshUtils.parseKey(keyData, passphrase);
      if (parsed instanceof Error) {
        throw keyParseError(parsed, Boolean(passphrase));
      }
      opts.privateKey = keyData;
      if (passphrase) opts.passphrase = passphrase;
    }
    return opts;
  }

  function keyParseError(err: Error, hasPassphrase: boolean): SshError {
    const msg = err.message;
    if (/encrypted.*no passphrase/i.test(msg)) {
      return new SshError('PASSPHRASE_REQUIRED', 'Key is encrypted — passphrase required. Edit the connection and enter the passphrase.');
    }
    if (/bad passphrase|bad decrypt|integrity check|HMAC/i.test(msg)) {
      return new SshError('BAD_PASSPHRASE', 'Incorrect passphrase for this key.');
    }
    if (/public key|no such/i.test(msg) && !hasPassphrase) {
      return new SshError('PUBLIC_KEY_SELECTED', 'Selected file is a public key. Pick the matching private key (without .pub).');
    }
    return new SshError('KEY_PARSE_ERROR', `Invalid private key: ${msg}`);
  }

  function dialOnce(conn: SshConnection, password: string | undefined, passphrase: string | undefined, sock?: any): Promise<Client> {
    const opts = buildAuth(conn, password, passphrase);
    if (sock) opts.sock = sock;

    let hostKeyError: Error | null = null;
    opts.hostVerifier = (key: any, cb: (ok: boolean) => void) => {
      const fp = fingerprintOf(Buffer.isBuffer(key) ? key : Buffer.from(key));
      const check: HostKeyCheck = hostKeys.check(conn.host, conn.port, fp);
      if (check === 'match') { cb(true); return; }
      if (check === 'unknown') {
        hostKeyError = new HostKeyPromptError(conn.host, conn.port, fp, 'unknown');
      } else {
        const known = hostKeys.list().find((k) => k.host === conn.host && k.port === conn.port);
        hostKeyError = new HostKeyPromptError(conn.host, conn.port, fp, 'mismatch', known?.fingerprint);
      }
      cb(false);
    };

    if (process.env.SSH_DEBUG) {
      opts.debug = (msg: string) => console.error(`[ssh2] ${conn.host}:${conn.port} ${msg}`);
    }

    return new Promise<Client>((resolve, reject) => {
      const client = new Client();
      let settled = false;
      client.on('ready', () => { settled = true; resolve(client); });
      client.on('error', (e) => {
        if (settled) return;
        settled = true;
        try { client.end(); } catch {}
        if (hostKeyError) return reject(hostKeyError);
        console.error(`[ssh] connect failed ${conn.username}@${conn.host}:${conn.port} keyPath=${conn.keyPath ?? '-'} err=${e.message}`);
        reject(wrapError(e));
      });
      client.on('close', () => {});
      client.connect(opts);
    });
  }

  async function connect(input: ConnectInput): Promise<{ sessionId: string }> {
    const { conn, password, passphrase, jumpHost, jumpHostSecrets } = input;
    let client: Client;
    let bastion: Client | undefined;
    if (jumpHost) {
      bastion = await dialOnce(jumpHost, jumpHostSecrets?.password, jumpHostSecrets?.passphrase);
      const sock = await new Promise<any>((resolve, reject) => {
        bastion!.forwardOut('127.0.0.1', 0, conn.host, conn.port, (err, stream) => {
          if (err) reject(new SshError('JUMP_HOST_FAILED', err.message));
          else resolve(stream);
        });
      });
      try {
        client = await dialOnce(conn, password, passphrase, sock);
      } catch (e) {
        bastion.end();
        throw e;
      }
    } else {
      client = await dialOnce(conn, password, passphrase);
    }

    const sessionId = crypto.randomUUID();
    const session: Session = {
      connectionId: conn.id,
      client,
      connectedAt: new Date().toISOString(),
      bastion,
    };
    sessions.set(sessionId, session);
    client.on('close', () => {
      sessions.delete(sessionId);
      session.bastion?.end();
      onSessionClosed?.(sessionId);
    });
    return { sessionId };
  }

  async function disconnect(sessionId: string): Promise<void> {
    const s = sessions.get(sessionId);
    if (!s) return;
    s.client.end();
    s.bastion?.end();
    sessions.delete(sessionId);
  }

  function get(sessionId: string): Session | null {
    return sessions.get(sessionId) ?? null;
  }

  function list(): SshSessionInfo[] {
    return Array.from(sessions.entries()).map(([sessionId, s]) => ({
      sessionId, connectionId: s.connectionId, connectedAt: s.connectedAt,
    }));
  }

  return { connect, disconnect, get, list };
}

export type SshManager = ReturnType<typeof createSshManager>;
