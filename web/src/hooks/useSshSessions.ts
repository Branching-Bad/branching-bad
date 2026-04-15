import { useCallback, useEffect, useState } from "react";
import { api } from "../api";
import type { SshSessionInfo, SshForwardStatus, HostKeyPromptPayload } from "../types";

export type ConnectResult =
  | { ok: true; sessionId: string }
  | { ok: false; hostKeyPrompt?: HostKeyPromptPayload; errorCode?: string; message?: string };

export function useSshSessions(opts: { setError: (msg: string) => void }) {
  const [sessions, setSessions] = useState<SshSessionInfo[]>([]);

  const refresh = useCallback(async () => {
    try {
      const res = await api<{ sessions: SshSessionInfo[] }>('/api/ssh/sessions');
      setSessions(res.sessions ?? []);
    } catch (e) { opts.setError((e as Error).message); }
  }, [opts]);

  useEffect(() => {
    void refresh();
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${protocol}//${window.location.host}/api/ws/global`);
    ws.onopen = () => { void refresh(); };
    ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data as string) as { type: string };
        if (msg.type === 'ssh_sessions_changed') void refresh();
      } catch { /* ignore malformed frames */ }
    };
    return () => ws.close();
  }, [refresh]);

  const connect = useCallback(async (connectionId: string): Promise<ConnectResult> => {
    try {
      const res = await fetch(`/api/ssh/connections/${encodeURIComponent(connectionId)}/connect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      if (res.status === 409) {
        const body = await res.json();
        return { ok: false, hostKeyPrompt: { host: body.host, port: body.port, fingerprint: body.fingerprint, kind: body.kind, expected: body.expected } };
      }
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        return { ok: false, errorCode: body.error ?? 'UNKNOWN', message: body.message ?? res.statusText };
      }
      const body = await res.json();
      await refresh();
      return { ok: true, sessionId: body.sessionId };
    } catch (e) {
      return { ok: false, errorCode: 'NETWORK', message: (e as Error).message };
    }
  }, [refresh]);

  const approveHostKey = useCallback(async (host: string, port: number, fingerprint: string) => {
    await api('/api/ssh/known-hosts', {
      method: 'POST', body: JSON.stringify({ host, port, fingerprint }),
    });
  }, []);

  const disconnect = useCallback(async (sessionId: string) => {
    await api(`/api/ssh/sessions/${encodeURIComponent(sessionId)}`, { method: 'DELETE' });
    await refresh();
  }, [refresh]);

  const launchSystemTerminal = useCallback(async (connectionId: string) => {
    await api(`/api/ssh/connections/${encodeURIComponent(connectionId)}/launch-terminal`, {
      method: 'POST',
    });
  }, []);

  const getForwardStatus = useCallback(async (sessionId: string): Promise<SshForwardStatus[]> => {
    const res = await api<{ status: SshForwardStatus[] }>(`/api/ssh/sessions/${encodeURIComponent(sessionId)}/forwards`);
    return res.status ?? [];
  }, []);

  const liveCount = sessions.length;

  return { sessions, liveCount, refresh, connect, approveHostKey, disconnect, launchSystemTerminal, getForwardStatus };
}

export type UseSshSessions = ReturnType<typeof useSshSessions>;
