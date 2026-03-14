import { useState, useCallback, useRef, useEffect, useMemo } from "react";
import type { RunLogEntry } from "../types";
import { api } from "../api";
import { useWebSocketStream } from "./useWebSocketStream";

export interface AnalystHistoryEntry {
  id: string;
  firstMessage: string;
  title: string | null;
  profileId: string;
  agentSessionId: string | null;
  logs: RunLogEntry[];
  timestamp: number;
}

interface DbSession {
  id: string;
  repo_id: string;
  profile_id: string;
  agent_session_id: string | null;
  title: string | null;
  first_message: string;
  status: "active" | "archived";
  created_at: string;
  updated_at: string;
}

interface DbLog {
  type: string;
  data: string;
}

function extractTitle(logs: RunLogEntry[]): string | null {
  for (let i = logs.length - 1; i >= 0; i--) {
    const entry = logs[i];
    if (entry.type !== "agent_text") continue;
    const startIdx = entry.data.indexOf("---TASK_OUTPUT_START---");
    const endIdx = entry.data.indexOf("---TASK_OUTPUT_END---");
    if (startIdx === -1 || endIdx === -1) continue;
    const block = entry.data.slice(startIdx + "---TASK_OUTPUT_START---".length, endIdx).trim();
    const titleMatch = block.match(/^Title:\s*(.+)$/m);
    if (titleMatch) return titleMatch[1].trim();
  }
  return null;
}

export function useAnalystState(repoId: string | null) {
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [profileId, setProfileId] = useState("");
  const [sendingHttp, setSendingHttp] = useState(false);
  const [history, setHistory] = useState<AnalystHistoryEntry[]>([]);
  const [viewingHistoryId, setViewingHistoryId] = useState<string | null>(null);
  const [historyLoaded, setHistoryLoaded] = useState(false);
  const profileIdRef = useRef(profileId);
  profileIdRef.current = profileId;

  const wsUrl = sessionId ? `/api/analyst/${sessionId}/ws` : null;
  const { logs, isConnected, clearLogs, appendLog } = useWebSocketStream(wsUrl);

  // Derive streaming state from WS events.
  // agent_done = agent finished a turn. If logs have no agent_done at all
  // (legacy sessions) we assume idle unless HTTP is in flight.
  const wsLoading = useMemo(() => {
    if (!sessionId || logs.length === 0) return false;
    // Check if this session has ever seen agent_done (new sessions will)
    const hasAgentDone = logs.some((l) => l.type === 'agent_done');
    if (!hasAgentDone) return false; // legacy session — rely on sendingHttp only
    // New session: check last significant event
    for (let i = logs.length - 1; i >= 0; i--) {
      const t = logs[i].type;
      if (t === 'agent_done') return false;
      if (t === 'agent_text' || t === 'thinking' || t === 'tool_use' || t === 'tool_result') return true;
      if (t === 'user_message') return true;
    }
    return false;
  }, [sessionId, logs]);

  // Load persisted sessions on repo change
  useEffect(() => {
    if (!repoId) return;
    setHistoryLoaded(false);
    api<DbSession[]>(`/api/repos/${encodeURIComponent(repoId)}/analyst/sessions`)
      .then((sessions) => {
        const entries: AnalystHistoryEntry[] = [];
        let activeSession: DbSession | null = null;

        for (const s of sessions) {
          if (s.status === "active") {
            activeSession = s;
          } else {
            entries.push({
              id: s.id,
              firstMessage: s.first_message.slice(0, 80),
              title: s.title,
              profileId: s.profile_id,
              agentSessionId: s.agent_session_id,
              logs: [], // loaded on demand
              timestamp: new Date(s.updated_at).getTime(),
            });
          }
        }

        setHistory(entries);

        // Restore active session
        if (activeSession) {
          setSessionId(activeSession.id);
          setProfileId(activeSession.profile_id);
          // Load its logs
          api<{ logs: DbLog[] }>(`/api/analyst/${activeSession.id}/logs`)
            .then(({ logs: savedLogs }) => {
              clearLogs();
              for (const l of savedLogs) appendLog(l);
            })
            .catch(() => {});
        } else {
          setSessionId(null);
          clearLogs();
        }

        setHistoryLoaded(true);
      })
      .catch(() => setHistoryLoaded(true));
  }, [repoId]); // eslint-disable-line react-hooks/exhaustive-deps

  const startSession = useCallback(async (rid: string, message: string, additionalRepoIds?: string[]) => {
    setViewingHistoryId(null);
    setSendingHttp(true);
    try {
      const body: Record<string, unknown> = { message, profileId: profileIdRef.current };
      if (additionalRepoIds?.length) body.additionalRepoIds = additionalRepoIds;
      const res = await api<{ sessionId: string }>(
        `/api/repos/${encodeURIComponent(rid)}/analyst/start`,
        { method: "POST", body: JSON.stringify(body) },
      );
      setSessionId(res.sessionId);
    } finally {
      setSendingHttp(false);
    }
  }, []);

  const sendMessage = useCallback(async (content: string) => {
    if (!sessionId) return;
    setSendingHttp(true);
    try {
      await api(`/api/analyst/${sessionId}/message`, {
        method: "POST",
        body: JSON.stringify({ content, profileId: profileIdRef.current }),
      });
    } finally {
      setSendingHttp(false);
    }
  }, [sessionId]);

  // Archive current session and reset for a new one
  const archiveAndReset = useCallback(async () => {
    if (sessionId) {
      const title = extractTitle(logs);
      // Update title + archive on server
      await api(`/api/analyst/${sessionId}`, {
        method: "PATCH",
        body: JSON.stringify({ title, status: "archived" }),
      }).catch(() => {});

      const firstMsg = logs.find((l) => l.type === "user_message");
      setHistory((prev) => [{
        id: sessionId,
        firstMessage: firstMsg ? firstMsg.data.slice(0, 80) : "Analysis",
        title,
        profileId: profileIdRef.current,
        agentSessionId: null,
        logs: [...logs],
        timestamp: Date.now(),
      }, ...prev]);
    }
    setSessionId(null);
    clearLogs();
    setViewingHistoryId(null);
  }, [sessionId, logs, clearLogs]);

  const loadHistoryEntry = useCallback(async (entryId: string | null) => {
    setViewingHistoryId(entryId);
    if (!entryId) return;

    // Load logs on demand if not cached
    setHistory((prev) => {
      const entry = prev.find((e) => e.id === entryId);
      if (entry && entry.logs.length > 0) return prev; // already loaded
      // Trigger async load
      api<{ session: DbSession; logs: DbLog[] }>(`/api/analyst/${entryId}/logs`)
        .then(({ session, logs: savedLogs }) => {
          setHistory((p) => p.map((e) =>
            e.id === entryId
              ? {
                  ...e,
                  logs: savedLogs.map((l) => ({ type: l.type, data: l.data })),
                  profileId: session.profile_id,
                  agentSessionId: session.agent_session_id,
                }
              : e,
          ));
        })
        .catch(() => {});
      return prev;
    });
  }, []);

  const deleteHistoryEntry = useCallback(async (entryId: string) => {
    await fetch(`/api/analyst/${entryId}`, { method: "DELETE" }).catch(() => {});
    setHistory((prev) => prev.filter((e) => e.id !== entryId));
    if (viewingHistoryId === entryId) setViewingHistoryId(null);
  }, [viewingHistoryId]);

  const extractTaskFields = useCallback((): { title: string; description: string } | null => {
    const source = viewingHistoryId
      ? history.find((h) => h.id === viewingHistoryId)?.logs ?? []
      : logs;
    for (let i = source.length - 1; i >= 0; i--) {
      const entry = source[i];
      if (entry.type !== "agent_text") continue;
      const startIdx = entry.data.indexOf("---TASK_OUTPUT_START---");
      const endIdx = entry.data.indexOf("---TASK_OUTPUT_END---");
      if (startIdx === -1 || endIdx === -1) continue;

      const block = entry.data.slice(startIdx + "---TASK_OUTPUT_START---".length, endIdx).trim();
      const titleMatch = block.match(/^Title:\s*(.+)$/m);
      const title = titleMatch ? titleMatch[1].trim() : "";
      const descStart = block.indexOf("Description:");
      const description = descStart !== -1
        ? block.slice(descStart + "Description:".length).trim()
        : block;

      return { title, description };
    }
    return null;
  }, [logs, viewingHistoryId, history]);

  return {
    sessionId,
    profileId,
    setProfileId,
    loading: sendingHttp || wsLoading,
    logs,
    isConnected,
    history,
    viewingHistoryId,
    historyLoaded,
    startSession,
    sendMessage,
    archiveAndReset,
    loadHistoryEntry,
    deleteHistoryEntry,
    extractTaskFields,
  };
}
