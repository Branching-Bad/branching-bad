import { useState, useEffect, useRef, useCallback } from "react";
import { api } from "../api";
import { THANOS_SNAP_DURATION_MS } from "../effects/thanos-snap";
import type { GlobalActiveRun } from "../types";

interface RunFinishedEvent {
  runId: string;
  taskId: string;
  repoId: string;
  taskTitle: string;
  status: GlobalActiveRun["status"];
}

interface TaskAppliedEvent {
  taskId: string;
  strategy: string;
  committed: boolean;
  filesChanged: number;
}

interface UseGlobalRunsOptions {
  onRunFinished?: (event: RunFinishedEvent) => void;
  onTaskApplied?: (event: TaskAppliedEvent) => void;
}

const FINISHED_STATUSES = new Set<GlobalActiveRun["status"]>(["done", "failed", "cancelled"]);
const AUTO_REMOVE_MS = 60_000;

export function useGlobalRuns({ onRunFinished, onTaskApplied }: UseGlobalRunsOptions = {}) {
  const [activeRuns, setActiveRuns] = useState<GlobalActiveRun[]>([]);
  // runIds currently playing the disintegration animation, kept in state so
  // StatusBar can re-render with the .thanos-snap class.
  const [exitingRunIds, setExitingRunIds] = useState<Set<string>>(new Set());
  const wsRef = useRef<WebSocket | null>(null);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancelledRef = useRef(false);
  const onRunFinishedRef = useRef(onRunFinished);
  const onTaskAppliedRef = useRef(onTaskApplied);
  // Per-runId timer that removes the chip after AUTO_REMOVE_MS once it reaches
  // a terminal status. Reset whenever the run is replaced or removed manually.
  const removalTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  useEffect(() => { onRunFinishedRef.current = onRunFinished; }, [onRunFinished]);
  useEffect(() => { onTaskAppliedRef.current = onTaskApplied; }, [onTaskApplied]);

  // Insert a run, dropping any older entry for the same task so the footer
  // shows at most one chip per task. Newest goes to the left.
  const upsertRun = useCallback((run: GlobalActiveRun) => {
    setActiveRuns((prev) => {
      const filtered = prev.filter((r) => r.taskId !== run.taskId);
      // Cancel any pending removal for runIds we are about to drop.
      for (const r of prev) {
        if (r.taskId === run.taskId && r.runId !== run.runId) {
          const t = removalTimersRef.current.get(r.runId);
          if (t) { clearTimeout(t); removalTimersRef.current.delete(r.runId); }
        }
      }
      return [run, ...filtered];
    });
  }, []);

  const cancelRemovalTimer = useCallback((runId: string) => {
    const t = removalTimersRef.current.get(runId);
    if (t) { clearTimeout(t); removalTimersRef.current.delete(runId); }
    setExitingRunIds((prev) => {
      if (!prev.has(runId)) return prev;
      const next = new Set(prev);
      next.delete(runId);
      return next;
    });
  }, []);

  const scheduleRemoval = useCallback((runId: string) => {
    cancelRemovalTimer(runId);
    // Phase 1: wait AUTO_REMOVE_MS, then start the snap animation.
    const startExit = setTimeout(() => {
      setExitingRunIds((prev) => {
        const next = new Set(prev);
        next.add(runId);
        return next;
      });
      // Phase 2: after the animation finishes, drop the run from state.
      const finalize = setTimeout(() => {
        removalTimersRef.current.delete(runId);
        setExitingRunIds((prev) => {
          if (!prev.has(runId)) return prev;
          const next = new Set(prev);
          next.delete(runId);
          return next;
        });
        setActiveRuns((prev) => prev.filter((r) => r.runId !== runId));
      }, THANOS_SNAP_DURATION_MS);
      removalTimersRef.current.set(runId, finalize);
    }, AUTO_REMOVE_MS);
    removalTimersRef.current.set(runId, startExit);
  }, [cancelRemovalTimer]);

  // Fetch initial active runs on mount: keep only the latest run per task and
  // schedule auto-removal for any that are already in a terminal state.
  useEffect(() => {
    void (async () => {
      try {
        const payload = await api<{ runs: GlobalActiveRun[] }>("/api/runs/active");
        const dedupedByTask = new Map<string, GlobalActiveRun>();
        for (const r of payload.runs) {
          const existing = dedupedByTask.get(r.taskId);
          if (!existing || new Date(r.startedAt) > new Date(existing.startedAt)) {
            dedupedByTask.set(r.taskId, r);
          }
        }
        const ordered = Array.from(dedupedByTask.values()).sort(
          (a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime(),
        );
        setActiveRuns(ordered);
        for (const r of ordered) {
          if (FINISHED_STATUSES.has(r.status)) scheduleRemoval(r.runId);
        }
      } catch { /* best-effort */ }
    })();
  }, [scheduleRemoval]);

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
            strategy?: string;
            committed?: boolean;
            filesChanged?: number;
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
            upsertRun(newRun);
            cancelRemovalTimer(msg.runId);
          } else if ((msg.type === "run_finished" || msg.type === "run_cancelled") && msg.runId) {
            const newStatus = msg.status as GlobalActiveRun["status"] ?? (msg.type === "run_cancelled" ? "cancelled" : "done");
            setActiveRuns((prev) =>
              prev.map((r) =>
                r.runId === msg.runId ? { ...r, status: newStatus } : r,
              ),
            );
            scheduleRemoval(msg.runId);
            // Fire toast callback directly from WS event
            onRunFinishedRef.current?.({
              runId: msg.runId,
              taskId: msg.taskId ?? "",
              repoId: msg.repoId ?? "",
              taskTitle: msg.taskTitle ?? "",
              status: newStatus,
            });
          } else if (msg.type === "task_applied" && msg.taskId) {
            onTaskAppliedRef.current?.({
              taskId: msg.taskId,
              strategy: msg.strategy ?? "squash",
              committed: msg.committed ?? false,
              filesChanged: msg.filesChanged ?? 0,
            });
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
      for (const t of removalTimersRef.current.values()) clearTimeout(t);
      removalTimersRef.current.clear();
    };
  }, [upsertRun, cancelRemovalTimer, scheduleRemoval]);

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

  const removeRun = useCallback((runId: string) => {
    cancelRemovalTimer(runId);
    setActiveRuns((prev) => prev.filter((r) => r.runId !== runId));
  }, [cancelRemovalTimer]);

  // visibleRuns = running + cancelled/failed + recently finished
  const visibleRuns = activeRuns.filter((r) =>
    r.status === "running" || r.status === "cancelled" || r.status === "failed" || r.status === "done",
  );

  return { visibleRuns, exitingRunIds, cancelRun, resumeRun, removeRun };
}
