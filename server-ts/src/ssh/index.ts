import type { Db } from '../db/index.js';
import { createHostKeyStore, type HostKeyStore } from './hostKeyStore.js';
import { createSshManager, type SshManager } from './sshManager.js';
import { createPtyManager, type PtyManager } from './ptyManager.js';
import { createForwardManager, type ForwardManager } from './forwardManager.js';
import { broadcastGlobalEvent } from '../websocket.js';

export interface SshModule {
  hostKeys: HostKeyStore;
  ssh: SshManager;
  pty: PtyManager;
  forwards: ForwardManager;
}

let singleton: SshModule | null = null;

export function getSshModule(db: Db): SshModule {
  if (singleton) return singleton;
  const hostKeys = createHostKeyStore(db);
  const ssh = createSshManager({
    hostKeys,
    onSessionClosed: () => broadcastGlobalEvent({ type: 'ssh_sessions_changed' }),
  });
  const pty = createPtyManager({ ssh });
  const forwards = createForwardManager({ ssh });
  singleton = { hostKeys, ssh, pty, forwards };
  return singleton;
}

export * from './types.js';
export { HostKeyPromptError, SshError } from './sshManager.js';
export { launchSystemTerminal } from './terminalLauncher.js';
export { exportAll, importAll } from './importExport.js';
export { detectSshmaster, importSshmaster } from './migration.js';
