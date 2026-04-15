import { useCallback, useEffect, useState } from "react";
import type { SshConnection, SshSessionInfo, SshForwardStatus } from "../../types";
import { SessionTabBar } from "./SessionTabBar";
import { Terminal } from "./Terminal";
import { btnSecondary } from "../shared";
import type { UseSshPty } from "../../hooks/useSshPty";
import type { UseSshSessions } from "../../hooks/useSshSessions";

interface TabRef { id: string; label: string; ptyId: string; sessionId: string }

export function ConnectionDetail({
  conn,
  sessions,
  pty,
  sshSessions,
  onEdit,
  onDelete,
  onRequestConnect,
}: {
  conn: SshConnection;
  sessions: SshSessionInfo[];
  pty: UseSshPty;
  sshSessions: UseSshSessions;
  onEdit: () => void;
  onDelete: () => void;
  onRequestConnect: () => Promise<string | null>;
}) {
  const [tabs, setTabs] = useState<TabRef[]>([]);
  const [activeTabId, setActiveTabId] = useState<string | null>(null);
  const [forwardStatuses, setForwardStatuses] = useState<SshForwardStatus[]>([]);
  const [connecting, setConnecting] = useState(false);

  // Keep tabs in sync with server-reported PTYs for this connection.
  useEffect(() => {
    const mine = sessions.filter((s) => s.connectionId === conn.id);
    const knownIds = new Set(tabs.map((t) => t.ptyId));
    const newTabs: TabRef[] = [...tabs];
    for (const s of mine) {
      for (const ptyId of s.ptys) {
        if (!knownIds.has(ptyId)) {
          newTabs.push({ id: ptyId, label: shortId(ptyId), ptyId, sessionId: s.sessionId });
          knownIds.add(ptyId);
        }
      }
    }
    const stillLive = new Set(mine.flatMap((s) => s.ptys));
    const filtered = newTabs.filter((t) => stillLive.has(t.ptyId));
    const changed =
      filtered.length !== tabs.length ||
      filtered.some((t, i) => t.ptyId !== tabs[i]?.ptyId);
    if (changed) {
      setTabs(filtered);
      if (!filtered.find((t) => t.id === activeTabId)) {
        setActiveTabId(filtered[0]?.id ?? null);
      }
    }
  }, [sessions, conn.id, tabs, activeTabId]);

  const { getForwardStatus } = sshSessions;
  useEffect(() => {
    const mine = sessions.filter((s) => s.connectionId === conn.id);
    if (mine.length === 0) { setForwardStatuses([]); return; }
    let cancelled = false;
    Promise.all(mine.map((s) => getForwardStatus(s.sessionId)))
      .then((lists) => { if (!cancelled) setForwardStatuses(lists.flat()); });
    return () => { cancelled = true; };
  }, [sessions, conn.id, getForwardStatus]);

  const newSession = useCallback(async () => {
    if (connecting) return;
    setConnecting(true);
    try {
      let sessionId = sessions.find((s) => s.connectionId === conn.id)?.sessionId;
      if (!sessionId) {
        const sid = await onRequestConnect();
        if (!sid) return;
        sessionId = sid;
      }
      const ptyId = await pty.openPty(sessionId, 80, 24);
      setTabs((p) => [...p, { id: ptyId, label: shortId(ptyId), ptyId, sessionId: sessionId! }]);
      setActiveTabId(ptyId);
    } finally {
      setConnecting(false);
    }
  }, [connecting, sessions, conn.id, pty, onRequestConnect]);

  const closeTab = useCallback(async (tabId: string) => {
    const tab = tabs.find((t) => t.id === tabId);
    if (!tab) return;
    await pty.closePty(tab.ptyId);
    setTabs((p) => p.filter((t) => t.id !== tabId));
    if (activeTabId === tabId) {
      setActiveTabId(null);
    }
  }, [tabs, pty, activeTabId]);

  const launchSystemTerminal = () => { void sshSessions.launchSystemTerminal(conn.id); };
  const disconnectAll = async () => {
    const mine = sessions.filter((s) => s.connectionId === conn.id);
    for (const s of mine) { await sshSessions.disconnect(s.sessionId); }
    setTabs([]); setActiveTabId(null);
  };

  return (
    <div className="flex h-full flex-1 flex-col">
      <header className="flex items-center justify-between border-b border-border-default px-6 py-3">
        <div className="min-w-0">
          <h2 className="truncate text-[14px] font-semibold text-text-primary">{conn.alias}</h2>
          <p className="truncate text-[11px] text-text-muted">
            {conn.username}@{conn.host}{conn.port !== 22 ? `:${conn.port}` : ''}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => void newSession()}
            disabled={connecting}
            className={btnSecondary + ' flex items-center gap-1.5 text-[11px] disabled:opacity-60'}
          >
            {connecting && <MiniSpinner />}
            {connecting ? 'Connecting…' : '+ New Session'}
          </button>
          <button onClick={onEdit} className={btnSecondary + ' text-[11px]'}>Edit</button>
          <button
            onClick={onDelete}
            className="rounded-md bg-status-danger/10 px-2.5 py-1 text-[11px] font-medium text-status-danger hover:bg-status-danger/20"
          >Delete</button>
        </div>
      </header>

      {forwardStatuses.length > 0 && (
        <div className="border-b border-border-default px-6 py-2 text-[11px] text-text-muted">
          Forwards: {forwardStatuses.map((f) => (
            <span key={f.forwardId} className={`mr-2 ${f.state === 'error' ? 'text-status-danger' : 'text-status-success'}`}>
              ● {f.forwardId.slice(0, 6)} {f.state}{f.message ? ` — ${f.message}` : ''}
            </span>
          ))}
        </div>
      )}

      {tabs.length > 0 ? (
        <>
          <SessionTabBar
            tabs={tabs.map((t) => ({ id: t.id, label: t.label }))}
            activeTabId={activeTabId}
            onSelect={setActiveTabId}
            onClose={(id) => void closeTab(id)}
            onNew={() => void newSession()}
          />
          <div className="relative flex-1 bg-[#0b0f14]">
            {tabs.map((t) => (
              <div key={t.id} className={`absolute inset-0 ${activeTabId === t.id ? '' : 'hidden'}`}>
                <Terminal
                  ptyId={t.ptyId}
                  active={activeTabId === t.id}
                  onClose={() => void closeTab(t.id)}
                />
              </div>
            ))}
          </div>
          <footer className="flex items-center justify-end gap-2 border-t border-border-default px-6 py-2 text-[11px]">
            <button onClick={launchSystemTerminal} disabled={conn.authType === 'password'} className={btnSecondary + ' text-[11px] disabled:opacity-50'} title={conn.authType === 'password' ? 'Password auth: use embedded terminal or key-based auth' : undefined}>
              System Terminal
            </button>
            <button onClick={() => void disconnectAll()} className="rounded-md bg-status-danger/10 px-2.5 py-1 font-medium text-status-danger hover:bg-status-danger/20">
              Disconnect
            </button>
          </footer>
        </>
      ) : (
        <div className="flex flex-1 items-center justify-center">
          <button
            onClick={() => void newSession()}
            disabled={connecting}
            className={btnSecondary + ' flex items-center gap-2 disabled:opacity-60'}
          >
            {connecting && <MiniSpinner />}
            {connecting ? 'Connecting…' : '+ New Session'}
          </button>
        </div>
      )}
    </div>
  );
}

function shortId(id: string): string { return id.slice(0, 6); }

function MiniSpinner() {
  return (
    <svg className="h-3 w-3 animate-spin" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
    </svg>
  );
}
