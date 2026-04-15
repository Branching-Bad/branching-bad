import { spawnSync, spawn } from 'node:child_process';
import type { SshConnection } from './types.js';

function buildSshArgs(target: SshConnection, jump?: SshConnection | null): string[] {
  const args: string[] = [];
  if (target.port !== 22) { args.push('-p', String(target.port)); }
  if (target.authType === 'key' && target.keyPath) { args.push('-i', target.keyPath); }
  if (jump) {
    const jumpSpec = `${jump.username}@${jump.host}${jump.port !== 22 ? ':' + jump.port : ''}`;
    args.push('-J', jumpSpec);
  }
  args.push(`${target.username}@${target.host}`);
  return args;
}

function which(bin: string): boolean {
  const probe = process.platform === 'win32'
    ? spawnSync('where', [bin], { stdio: 'ignore' })
    : spawnSync('which', [bin], { stdio: 'ignore' });
  return probe.status === 0;
}

export function launchSystemTerminal(target: SshConnection, jump?: SshConnection | null): void {
  const args = buildSshArgs(target, jump);
  const sshCmd = ['ssh', ...args];

  if (process.platform === 'darwin') {
    const cmd = sshCmd.map((a) => `'${a.replace(/'/g, `'\\''`)}'`).join(' ');
    const osa = `tell application "Terminal" to do script "${cmd.replace(/"/g, '\\"')}"\nactivate application "Terminal"`;
    const r = spawnSync('osascript', ['-e', osa], { stdio: 'ignore' });
    if (r.status !== 0) throw new Error('LAUNCH_FAILED: osascript exited ' + r.status);
    return;
  }

  if (process.platform === 'win32') {
    if (which('wt.exe') || which('wt')) {
      const r = spawnSync('wt.exe', ['-w', '0', 'nt', ...sshCmd], { stdio: 'ignore', shell: false });
      if (r.status === 0) return;
    }
    const r = spawnSync('cmd', ['/c', 'start', 'cmd', '/k', ...sshCmd], { stdio: 'ignore' });
    if (r.status !== 0) throw new Error('LAUNCH_FAILED: cmd start exited ' + r.status);
    return;
  }

  const candidates = [
    { bin: 'gnome-terminal', args: ['--', ...sshCmd] },
    { bin: 'konsole', args: ['-e', ...sshCmd] },
    { bin: 'x-terminal-emulator', args: ['-e', ...sshCmd] },
    { bin: 'xterm', args: ['-e', ...sshCmd] },
  ];
  for (const { bin, args: a } of candidates) {
    if (which(bin)) {
      spawn(bin, a, { stdio: 'ignore', detached: true }).unref();
      return;
    }
  }
  const e = new Error('NO_TERMINAL: no known terminal emulator found');
  (e as any).code = 'NO_TERMINAL';
  throw e;
}
