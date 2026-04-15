import { spawn } from 'node:child_process';
import type { ResolvedMcpServer } from './model.js';

export interface TestResult {
  ok: boolean;
  tools: string[];
  stderr: string;
  error?: string;
}

/**
 * Spawn the MCP server, send a `tools/list` JSON-RPC request over stdio,
 * await the response for up to `timeoutMs`, then kill the process.
 */
export async function testMcpConnection(
  server: ResolvedMcpServer,
  timeoutMs = 8000,
): Promise<TestResult> {
  return await new Promise<TestResult>((resolve) => {
    let stderr = '';
    let stdoutBuf = '';
    let settled = false;
    const done = (r: TestResult) => {
      if (!settled) {
        settled = true;
        try { child.kill('SIGTERM'); } catch {}
        resolve(r);
      }
    };

    const child = spawn(server.command, server.args, {
      env: { ...process.env, ...server.env },
      shell: process.platform === 'win32',
    });

    child.on('error', (err) => done({ ok: false, tools: [], stderr, error: String(err) }));

    child.stderr.on('data', (c: Buffer) => { stderr += c.toString('utf8'); });

    child.stdout.on('data', (c: Buffer) => {
      stdoutBuf += c.toString('utf8');
      let idx: number;
      while ((idx = stdoutBuf.indexOf('\n')) !== -1) {
        const line = stdoutBuf.slice(0, idx).trim();
        stdoutBuf = stdoutBuf.slice(idx + 1);
        if (!line) continue;
        try {
          const msg = JSON.parse(line) as { id?: number; result?: { tools?: Array<{ name: string }> }; error?: unknown };
          if (msg.id === 1 && msg.result?.tools) {
            done({ ok: true, tools: msg.result.tools.map((t) => t.name), stderr });
            return;
          }
          if (msg.id === 1 && msg.error) {
            done({ ok: false, tools: [], stderr, error: JSON.stringify(msg.error) });
            return;
          }
        } catch { /* not a JSON line, skip */ }
      }
    });

    const req = { jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} };
    child.stdin.write(JSON.stringify(req) + '\n');

    setTimeout(() => done({ ok: false, tools: [], stderr, error: 'timeout' }), timeoutMs);
  });
}
