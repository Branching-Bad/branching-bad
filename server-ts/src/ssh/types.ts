export interface SshGroup {
  id: string;
  name: string;
  createdAt: string;
}

export type AuthType = 'password' | 'key';
export type ForwardType = 'local' | 'remote';

export interface SshForward {
  id: string;
  connectionId: string;
  forwardType: ForwardType;
  bindAddress: string;
  bindPort: number;
  remoteHost: string;
  remotePort: number;
  createdAt: string;
}

export interface SshConnection {
  id: string;
  alias: string;
  groupId: string | null;
  host: string;
  port: number;
  username: string;
  authType: AuthType;
  keyPath: string | null;
  hasPassword: boolean;
  hasPassphrase: boolean;
  jumpHostId: string | null;
  forwards: SshForward[];
  lastConnectedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SshHostKey {
  host: string;
  port: number;
  fingerprint: string;
  approvedAt: string;
}

export interface SshHistoryEntry {
  id: string;
  connectionId: string;
  attemptedAt: string;
  status: 'connected' | 'failed';
  errorCode: string | null;
  durationSec: number | null;
}

export interface SshSessionInfo {
  sessionId: string;
  connectionId: string;
  connectedAt: string;
}

export interface SshForwardStatus {
  forwardId: string;
  state: 'active' | 'error';
  message?: string;
}
