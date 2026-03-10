import { useState, useEffect, useRef, useCallback } from "react";
import { api } from "../api";
import type { GlobalActiveRun } from "../types";

export function useGlobalRuns() {
  const [activeRuns, setActiveRuns] = useState<GlobalActiveRun[]>([]);
  const [seenRunIds, setSeenRunIds] = useState<Set<string>>(new Set());
  const wsRef = useRef<WebSocket | null>(null);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancelledRef = useRef(false);

  // Fetch initial active runs on mount
  useEffect(() => {
    void (async () => {
      try {
        const payload = await api<{ runs: GlobalActiveRun[] }>("/api/runs/active");
        setActiveRuns(payload.runs);
      } catch { /* best-effort */ }
    })();
  }, []);

  // WebSocket connection for real-time updates
  useEffect(() => {
    cancelledRef.current = false;

    const connect = () => {
      if (cancelledRef.current) return;

      const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
      const wsUrl = `${protocol}//${window.location.host}/api/ws/global`;
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onmessage = (event) => {
        if (cancelledRef.current) return;
        try {
          const msg = JSON.parse(event.data as string) as {
            type: string;
            runId?: string;
            taskId?: string;
            repoId?: string;
            taskTitle?: string;
            repoName?: string;
            status?: string;
          };

          if (msg.type === "run_started" && msg.runId) {
            const newRun: GlobalActiveRun = {
              runId: msg.runId,
              taskId: msg.taskId ?? "",
              repoId: msg.repoId ?? "",
              taskTitle: msg.taskTitle ?? "",
              repoName: msg.repoName ?? "",
              status: "running",
              startedAt: new Date().toISOString(),
            };
            setActiveRuns((prev) =>
              prev.some((r) => r.runId === msg.runId) ? prev : [...prev, newRun],
            );
          } else if ((msg.type === "run_finished" || msg.type === "run_cancelled") && msg.runId) {
            const newStatus = msg.status as GlobalActiveRun["status"] ?? (msg.type === "run_cancelled" ? "cancelled" : "done");
            setActiveRuns((prev) =>
              prev.map((r) =>
                r.runId === msg.runId ? { ...r, status: newStatus } : r,
              ),
            );
          }
        } catch { /* ignore malformed messages */ }
      };

      ws.onclose = () => {
        if (cancelledRef.current) return;
        wsRef.current = null;
        retryTimerRef.current = setTimeout(connect, 3000);
      };

      ws.onerror = () => {
        // onclose will fire after this
      };
    };

    connect();

    return () => {
      cancelledRef.current = true;
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
      if (retryTimerRef.current) {
        clearTimeout(retryTimerRef.current);
        retryTimerRef.current = null;
      }
    };
  }, []);

  const cancelRun = useCallback(async (runId: string) => {
    try {
      await api(`/api/runs/${runId}/cancel`, { method: "POST" });
      setActiveRuns((prev) =>
        prev.map((r) => (r.runId === runId ? { ...r, status: "cancelled" } : r)),
      );
    } catch { /* best-effort */ }
  }, []);

  const resumeRun = useCallback(async (runId: string) => {
    try {
      await api(`/api/runs/${runId}/resume`, { method: "POST" });
    } catch { /* best-effort */ }
  }, []);

  const markSeen = useCallback((runId: string) => {
    setSeenRunIds((prev) => new Set([...prev, runId]));
  }, []);

  // visibleRuns = running + cancelled/failed + completed-but-unseen
  const visibleRuns = activeRuns.filter((r) => {
    if (r.status === "running") return true;
    if (r.status === "cancelled" || r.status === "failed") return true;
    if (r.status === "done" && !seenRunIds.has(r.runId)) return true;
    return false;
  });

  // unseenFinished = done/failed runs not yet seen (for toast triggering)
  const unseenFinished = activeRuns.filter(
    (r) => (r.status === "done" || r.status === "failed") && !seenRunIds.has(r.runId),
  );

  return { visibleRuns, unseenFinished, cancelRun, resumeRun, markSeen };
}
