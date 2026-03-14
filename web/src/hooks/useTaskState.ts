import { useState, useMemo, useCallback, useEffect, useRef } from "react";
import { api } from "../api";
import type { Task, LaneKey } from "../types";
import { laneFromStatus } from "../components/shared";
import type { StreamFunctions } from "./streamTypes";
import { usePolling } from "./usePolling";

/** Coalescing wrapper: concurrent calls share a single in-flight request. */
function useCoalescingFetch<T>(
  fetcher: () => Promise<T>,
): () => Promise<T | undefined> {
  const inflight = useRef<Promise<T | undefined> | null>(null);
  return useCallback(() => {
    if (inflight.current) return inflight.current;
    const p = fetcher()
      .then((v) => { inflight.current = null; return v; })
      .catch(() => { inflight.current = null; return undefined; });
    inflight.current = p;
    return p;
  }, [fetcher]);
}

export function useTaskState({
  selectedRepoId,
  streamRef,
  setSelectedProfileId,
  setError, setInfo, setBusy,
}: {
  selectedRepoId: string;
  streamRef: React.RefObject<StreamFunctions | null>;
  setSelectedProfileId: (v: string) => void;
  setError: (msg: string) => void;
  setInfo: (msg: string) => void;
  setBusy: (v: boolean) => void;
}) {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [selectedTaskId, setSelectedTaskId] = useState("");

  const selectedTask = useMemo(() => tasks.find((t) => t.id === selectedTaskId) ?? null, [tasks, selectedTaskId]);
  const groupedTasks = useMemo(
    () => tasks.reduce<Record<LaneKey, Task[]>>(
      (acc, task) => { acc[laneFromStatus(task.status)].push(task); return acc; },
      { todo: [], inprogress: [], inreview: [], done: [], archived: [] },
    ),
    [tasks],
  );

  const selectedTaskIdRef = useRef(selectedTaskId);
  selectedTaskIdRef.current = selectedTaskId;

  const statusFromLane = useCallback((lane: LaneKey): string => {
    switch (lane) {
      case "todo": return "To Do";
      case "inprogress": return "In Progress";
      case "inreview": return "In Review";
      case "done": return "Done";
      case "archived": return "ARCHIVED";
    }
  }, []);

  const fetchTasks = useCallback(() => {
    if (!selectedRepoId) return Promise.resolve(undefined);
    return api<{ tasks: Task[] }>(`/api/tasks?repoId=${encodeURIComponent(selectedRepoId)}`);
  }, [selectedRepoId]);

  const coalescedFetch = useCoalescingFetch(fetchTasks);

  const refreshTasks = useCallback(async () => {
    const payload = await coalescedFetch();
    if (payload) setTasks(payload.tasks);
  }, [coalescedFetch]);

  // Load tasks + agent selection when repo changes
  useEffect(() => {
    streamRef.current?.closeAllRunStreams();
    streamRef.current?.closeAllPlanStreams();
    if (!selectedRepoId) { setTasks([]); setSelectedTaskId(""); setSelectedProfileId(""); return; }
    void (async () => {
      try {
        const [taskPayload, selectionPayload] = await Promise.all([
          api<{ tasks: Task[] }>(`/api/tasks?repoId=${encodeURIComponent(selectedRepoId)}`),
          api<{ selection: { agent_profile_id: string } | null }>(`/api/agents/selection?repoId=${encodeURIComponent(selectedRepoId)}`),
        ]);
        setTasks(taskPayload.tasks);
        setSelectedTaskId(taskPayload.tasks[0]?.id ?? "");
        setSelectedProfileId(selectionPayload.selection?.agent_profile_id ?? "");
      } catch (e) { setError((e as Error).message); }
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedRepoId]);

  // Task polling
  usePolling(refreshTasks, 4000, !!selectedRepoId);

  const createManualTask = useCallback(async (fields: {
    title: string; description: string; priority: string;
    requirePlan: boolean; autoApprovePlan: boolean; autoStart: boolean;
    useWorktree: boolean; carryDirtyState: boolean; agentProfileId: string;
  }) => {
    if (!selectedRepoId || !fields.title.trim()) return;
    setBusy(true); setError("");
    try {
      await api("/api/tasks", {
        method: "POST",
        body: JSON.stringify({
          repoId: selectedRepoId, title: fields.title.trim(),
          description: fields.description.trim() || undefined, status: "To Do",
          priority: fields.priority || undefined, requirePlan: fields.requirePlan,
          autoApprovePlan: fields.autoApprovePlan, autoStart: fields.autoStart,
          useWorktree: fields.useWorktree,
          carryDirtyState: fields.carryDirtyState,
          agentProfileId: fields.agentProfileId || undefined,
        }),
      });
      await refreshTasks();
      setInfo("Task created.");
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }, [selectedRepoId, refreshTasks, setBusy, setError, setInfo]);

  const saveTaskEdits = useCallback(async (taskId: string, fields: {
    title: string; description: string; priority: string;
    requirePlan: boolean; autoApprovePlan: boolean; autoStart: boolean;
    useWorktree: boolean; carryDirtyState: boolean; agentProfileId: string;
  }) => {
    if (!taskId || !fields.title.trim()) return;
    setBusy(true); setError("");
    try {
      const payload = await api<{ task: Task }>(`/api/tasks/${taskId}`, {
        method: "PATCH",
        body: JSON.stringify({
          title: fields.title.trim(), description: fields.description.trim() || null,
          priority: fields.priority || null, requirePlan: fields.requirePlan,
          autoApprovePlan: fields.autoApprovePlan, autoStart: fields.autoStart,
          useWorktree: fields.useWorktree,
          carryDirtyState: fields.carryDirtyState,
          agentProfileId: fields.agentProfileId || null,
        }),
      });
      setTasks((prev) => prev.map((t) => t.id === payload.task.id ? payload.task : t));
      setInfo("Task updated.");
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }, [setBusy, setError, setInfo]);

  const deleteTask = useCallback(async (task: Task) => {
    if (!window.confirm(`Delete task "${task.jira_issue_key} - ${task.title}"? This cannot be undone.`)) return;
    try {
      await api(`/api/tasks/${task.id}`, { method: "DELETE" });
      setSelectedTaskId("");
      setTasks((prev) => prev.filter((t) => t.id !== task.id));
    } catch (err) { setError((err as Error).message); }
  }, [setError]);

  const requeueAutostart = useCallback(async () => {
    if (!selectedTask) return;
    setBusy(true); setError("");
    try {
      await api(`/api/tasks/${selectedTask.id}/autostart/requeue`, { method: "POST" });
      setInfo("Task requeued for autostart pipeline.");
      await refreshTasks();
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }, [selectedTask, refreshTasks, setBusy, setError, setInfo]);

  const clearTaskPipeline = useCallback(async () => {
    if (!selectedTask) return;
    setBusy(true); setError("");
    try {
      const result = await api<{ cleared: boolean; plan_jobs_failed: number; autostart_jobs_failed: number; task_reset: boolean }>(
        `/api/tasks/${selectedTask.id}/pipeline/clear`, { method: "POST" },
      );
      const parts: string[] = [];
      if (result.plan_jobs_failed > 0) parts.push(`${result.plan_jobs_failed} plan job`);
      if (result.autostart_jobs_failed > 0) parts.push(`${result.autostart_jobs_failed} autostart job`);
      if (result.task_reset) parts.push("task status reset");
      setInfo(parts.length > 0 ? `Pipeline temizlendi: ${parts.join(", ")}` : "Temizlenecek bir şey yoktu.");
      await refreshTasks();
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }, [selectedTask, refreshTasks, setBusy, setError, setInfo]);

  const clearAllPipelines = useCallback(async () => {
    setBusy(true); setError("");
    try {
      const result = await api<{ cleared: boolean; plan_jobs_failed: number; autostart_jobs_failed: number; task_reset: boolean }>(
        "/api/pipeline/clear-all", { method: "POST" },
      );
      const parts: string[] = [];
      if (result.plan_jobs_failed > 0) parts.push(`${result.plan_jobs_failed} plan job`);
      if (result.autostart_jobs_failed > 0) parts.push(`${result.autostart_jobs_failed} autostart job`);
      if (result.task_reset) parts.push("task status reset");
      setInfo(parts.length > 0 ? `Tüm pipeline temizlendi: ${parts.join(", ")}` : "Temizlenecek bir şey yoktu.");
      await refreshTasks();
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }, [refreshTasks, setBusy, setError, setInfo]);

  return {
    tasks, setTasks, selectedTaskId, setSelectedTaskId,
    selectedTask, groupedTasks, selectedTaskIdRef,
    statusFromLane, refreshTasks,
    createManualTask, saveTaskEdits, deleteTask,
    requeueAutostart, clearTaskPipeline, clearAllPipelines,
  };
}
