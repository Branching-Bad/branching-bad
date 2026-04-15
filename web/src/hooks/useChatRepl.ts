import { useState, useCallback, useRef, useEffect, useMemo } from "react";
import type { RunLogEntry } from "../types";
import { api } from "../api";
import { useWebSocketStream } from "./useWebSocketStream";

export interface ChatHistoryEntry {
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

export function useChatRepl(repoId: string | null) {
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [profileId, setProfileId] = useState("");
  const [sendingHttp, setSendingHttp] = useState(false);
  const [history, setHistory] = useState<ChatHistoryEntry[]>([]);
  const [viewingHistoryId, setViewingHistoryId] = useState<string | null>(null);
  const [historyLoaded, setHistoryLoaded] = useState(false);
  const profileIdRef = useRef(profileId);
  profileIdRef.current = profileId;

  const wsUrl = sessionId ? `/api/chat/${sessionId}/ws` : null;
  const { logs, isConnected, clearLogs, appendLog } = useWebSocketStream(wsUrl);

  // Streaming state derived from agent_done markers (set by backend on child exit).
  const wsLoading = useMemo(() => {
    if (!sessionId || logs.length === 0) return false;
    const hasAgentDone = logs.some((l) => l.type === "agent_done");
    if (!hasAgentDone) return false;
    for (let i = logs.length - 1; i >= 0; i--) {
      const t = logs[i].type;
      if (t === "agent_done") return false;
      if (t === "agent_text" || t === "thinking" || t === "tool_use" || t === "tool_result" || t === "user_message") return true;
    }
    return false;
  }, [sessionId, logs]);

  // Load persisted sessions on repo change
  useEffect(() => {
    if (!repoId) return;
    setHistoryLoaded(false);
    api<DbSession[]>(`/api/repos/${encodeURIComponent(repoId)}/chat/sessions`)
      .then((sessions) => {
        const entries: ChatHistoryEntry[] = [];
        let activeSession: DbSession | null = null;

        for (const s of sessions) {
          if (s.status === "active" && !activeSession) {
            activeSession = s;
          } else {
            entries.push({
              id: s.id,
              firstMessage: s.first_message.slice(0, 80),
              title: s.title,
              profileId: s.profile_id,
              agentSessionId: s.agent_session_id,
              logs: [],
              timestamp: new Date(s.updated_at).getTime(),
            });
          }
        }

        setHistory(entries);

        if (activeSession) {
          setSessionId(activeSession.id);
          setProfileId(activeSession.profile_id);
          api<{ logs: DbLog[] }>(`/api/chat/${activeSession.id}/logs`)
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

  const startSession = useCallback(async (rid: string, message: string) => {
    setViewingHistoryId(null);
    setSendingHttp(true);
    try {
      const res = await api<{ sessionId: string }>(
        `/api/repos/${encodeURIComponent(rid)}/chat/start`,
        { method: "POST", body: JSON.stringify({ message, profileId: profileIdRef.current }) },
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
      await api(`/api/chat/${sessionId}/message`, {
        method: "POST",
        body: JSON.stringify({ content, profileId: profileIdRef.current }),
      });
    } finally {
      setSendingHttp(false);
    }
  }, [sessionId]);

  const stopCurrent = useCallback(async () => {
    if (!sessionId) return;
    await api(`/api/chat/${sessionId}/stop`, { method: "POST" }).catch(() => {});
  }, [sessionId]);

  const createMemory = useCallback(async (): Promise<{ title: string } | null> => {
    if (!sessionId) return null;
    try {
      const res = await api<{ memory: { title: string } }>(
        `/api/chat/${sessionId}/memory`,
        { method: "POST" },
      );
      return { title: res.memory.title };
    } catch {
      return null;
    }
  }, [sessionId]);

  const archiveAndReset = useCallback(async () => {
    if (sessionId) {
      const firstMsg = logs.find((l) => l.type === "user_message");
      await api(`/api/chat/${sessionId}`, {
        method: "PATCH",
        body: JSON.stringify({ status: "archived" }),
      }).catch(() => {});

      setHistory((prev) => [{
        id: sessionId,
        firstMessage: firstMsg ? firstMsg.data.slice(0, 80) : "Chat",
        title: null,
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

    setHistory((prev) => {
      const entry = prev.find((e) => e.id === entryId);
      if (entry && entry.logs.length > 0) return prev;
      api<{ session: DbSession; logs: DbLog[] }>(`/api/chat/${entryId}/logs`)
        .then(({ session, logs: savedLogs }) => {
          setHistory((p) => p.map((e) =>
            e.id === entryId
              ? { ...e, logs: savedLogs.map((l) => ({ type: l.type, data: l.data })),
                  profileId: session.profile_id, agentSessionId: session.agent_session_id }
              : e,
          ));
        })
        .catch(() => {});
      return prev;
    });
  }, []);

  const deleteHistoryEntry = useCallback(async (entryId: string) => {
    await fetch(`/api/chat/${entryId}`, { method: "DELETE" }).catch(() => {});
    setHistory((prev) => prev.filter((e) => e.id !== entryId));
    if (viewingHistoryId === entryId) setViewingHistoryId(null);
    if (sessionId === entryId) { setSessionId(null); clearLogs(); }
  }, [viewingHistoryId, sessionId, clearLogs]);

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
    stopCurrent,
    createMemory,
    archiveAndReset,
    loadHistoryEntry,
    deleteHistoryEntry,
  };
}

export type UseChatRepl = ReturnType<typeof useChatRepl>;
