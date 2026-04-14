import { useState, useCallback, useRef, useEffect, useMemo } from "react";
import type { Repo, AgentProfile, RunLogEntry, AnalystHistoryEntry, AnalystSession, AnalystLog } from "../types";
import { api } from "../api";
import { useWebSocketStream } from "./useWebSocketStream";

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

export function useAnalystState() {
  const [repos, setRepos] = useState<Repo[]>([]);
  const [profiles, setProfiles] = useState<AgentProfile[]>([]);
  const [repoId, setRepoId] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [profileId, setProfileId] = useState("");
  const [sendingHttp, setSendingHttp] = useState(false);
  const [history, setHistory] = useState<AnalystHistoryEntry[]>([]);
  const [viewingHistoryId, setViewingHistoryId] = useState<string | null>(null);
  const [historyLoaded, setHistoryLoaded] = useState(false);
  const [booted, setBooted] = useState(false);
  const profileIdRef = useRef(profileId);
  profileIdRef.current = profileId;

  const wsUrl = sessionId ? `/api/analyst/${sessionId}/ws` : null;
  const { logs, isConnected, isFinished, clearLogs, appendLog } = useWebSocketStream(wsUrl);

  // Derive streaming state from WS events.
  const wsLoading = useMemo(() => {
    if (!sessionId || logs.length === 0) return false;
    const hasAgentDone = logs.some((l) => l.type === "agent_done");
    if (!hasAgentDone) return false;
    for (let i = logs.length - 1; i >= 0; i--) {
      const t = logs[i].type;
      if (t === "agent_done") return false;
      if (t === "agent_text" || t === "thinking" || t === "tool_use" || t === "tool_result") return true;
      if (t === "user_message") return true;
    }
    return false;
  }, [sessionId, logs]);

  // Bootstrap: fetch repos + profiles
  useEffect(() => {
    Promise.all([
      api<{ repos: Repo[] }>("/api/repos"),
      api<{ profiles: AgentProfile[] }>("/api/agents"),
    ]).then(([rRes, pRes]) => {
      const r = rRes.repos;
      const p = pRes.profiles;
      setRepos(r);
      setProfiles(p);
      if (p.length > 0) setProfileId(p[0].id);
      if (r.length > 0) setRepoId(r[0].id);
      setBooted(true);
    }).catch(() => setBooted(true));
  }, []);

  // Load sessions on repo change
  useEffect(() => {
    if (!repoId) return;
    setHistoryLoaded(false);
    setSessionId(null);
    setViewingHistoryId(null);
    clearLogs();

    api<AnalystSession[]>(`/api/repos/${encodeURIComponent(repoId)}/analyst/sessions`)
      .then((sessions) => {
        const entries: AnalystHistoryEntry[] = [];
        let activeSession: AnalystSession | null = null;

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
              logs: [],
              timestamp: new Date(s.updated_at).getTime(),
            });
          }
        }

        setHistory(entries);

        if (activeSession) {
          setSessionId(activeSession.id);
          setProfileId(activeSession.profile_id);
          api<{ logs: AnalystLog[] }>(`/api/analyst/${activeSession.id}/logs`)
            .then(({ logs: savedLogs }) => {
              clearLogs();
              for (const l of savedLogs) appendLog(l);
            })
            .catch(() => {});
        }

        setHistoryLoaded(true);
      })
      .catch(() => setHistoryLoaded(true));
  }, [repoId]); // eslint-disable-line react-hooks/exhaustive-deps

  const startSession = useCallback(async (message: string) => {
    if (!repoId) return;
    setViewingHistoryId(null);
    setSendingHttp(true);
    try {
      const body: Record<string, unknown> = { message, profileId: profileIdRef.current };
      const res = await api<{ sessionId: string }>(
        `/api/repos/${encodeURIComponent(repoId)}/analyst/start`,
        { method: "POST", body: JSON.stringify(body) },
      );
      setSessionId(res.sessionId);
    } finally {
      setSendingHttp(false);
    }
  }, [repoId]);

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

  const archiveAndReset = useCallback(async () => {
    if (sessionId) {
      const title = extractTitle(logs);
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

    setHistory((prev) => {
      const entry = prev.find((e) => e.id === entryId);
      if (entry && entry.logs.length > 0) return prev;
      api<{ session: AnalystSession; logs: AnalystLog[] }>(`/api/analyst/${entryId}/logs`)
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

  return {
    repos,
    profiles,
    repoId,
    setRepoId,
    sessionId,
    profileId,
    setProfileId,
    loading: sendingHttp || wsLoading,
    logs,
    isConnected,
    isFinished,
    history,
    viewingHistoryId,
    historyLoaded,
    booted,
    startSession,
    sendMessage,
    archiveAndReset,
    loadHistoryEntry,
    deleteHistoryEntry,
  };
}
