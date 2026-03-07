import { useState, useCallback, useRef } from "react";
import { api } from "../api";
import { useWebSocketStream } from "./useWebSocketStream";

export function useAnalystState() {
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [profileId, setProfileId] = useState("");
  const [loading, setLoading] = useState(false);
  const profileIdRef = useRef(profileId);
  profileIdRef.current = profileId;

  const wsUrl = sessionId ? `/api/analyst/${sessionId}/ws` : null;
  const { logs, isConnected, clearLogs } = useWebSocketStream(wsUrl);

  const startSession = useCallback(async (repoId: string, message: string, additionalRepoIds?: string[]) => {
    setLoading(true);
    try {
      const body: Record<string, unknown> = { message, profileId: profileIdRef.current };
      if (additionalRepoIds?.length) body.additionalRepoIds = additionalRepoIds;
      const res = await api<{ sessionId: string }>(
        `/api/repos/${encodeURIComponent(repoId)}/analyst/start`,
        { method: "POST", body: JSON.stringify(body) },
      );
      setSessionId(res.sessionId);
    } finally {
      setLoading(false);
    }
  }, []);

  const sendMessage = useCallback(async (content: string) => {
    if (!sessionId) return;
    setLoading(true);
    try {
      await api(`/api/analyst/${sessionId}/message`, {
        method: "POST",
        body: JSON.stringify({ content, profileId: profileIdRef.current }),
      });
    } finally {
      setLoading(false);
    }
  }, [sessionId]);

  const closeSession = useCallback(async () => {
    if (sessionId) {
      try {
        await fetch(`/api/analyst/${sessionId}`, { method: "DELETE" });
      } catch { /* ignore */ }
    }
    setSessionId(null);
    clearLogs();
  }, [sessionId, clearLogs]);

  const extractTaskFields = useCallback((): { title: string; description: string } | null => {
    for (let i = logs.length - 1; i >= 0; i--) {
      const entry = logs[i];
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
  }, [logs]);

  return {
    sessionId,
    profileId,
    setProfileId,
    loading,
    logs,
    isConnected,
    startSession,
    sendMessage,
    closeSession,
    extractTaskFields,
  };
}
