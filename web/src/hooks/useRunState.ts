import { useState, useCallback, useEffect } from "react";
import { api } from "../api";
import type { Task, ActiveRun, RunEvent, TaskRunState } from "../types";
import { EMPTY_TASK_RUN_STATE } from "../types";
import type { StreamFunctions } from "./streamTypes";

type RunAgent = { id: string; provider: string; agent_name: string; model: string };

export function useRunState({
  selectedTaskId,
  selectedRepoId,
  selectedProfileId,
  selectedTask,
  approvedPlan,
  streamRef,
  setTasks,
  setError, setInfo, setBusy,
}: {
  selectedTaskId: string;
  selectedRepoId: string;
  selectedProfileId: string;
  selectedTask: Task | null;
  approvedPlan: { id: string } | null;
  streamRef: React.RefObject<StreamFunctions | null>;
  setTasks: React.Dispatch<React.SetStateAction<Task[]>>;
  setError: (msg: string) => void;
  setInfo: (msg: string) => void;
  setBusy: (v: boolean) => void;
}) {
  const [taskRunStates, setTaskRunStates] = useState<Record<string, TaskRunState>>({});

  const updateTaskRunState = useCallback(
    (taskId: string, updater: (current: TaskRunState) => TaskRunState) => {
      setTaskRunStates((prev) => {
        const current = prev[taskId] ?? EMPTY_TASK_RUN_STATE;
        return { ...prev, [taskId]: updater(current) };
      });
    },
    [],
  );

  const selectedTaskRunState = selectedTaskId
    ? (taskRunStates[selectedTaskId] ?? EMPTY_TASK_RUN_STATE)
    : EMPTY_TASK_RUN_STATE;
  const activeRun = selectedTaskRunState.activeRun;
  const runLogs = selectedTaskRunState.runLogs;
  const runFinished = selectedTaskRunState.runFinished;
  const runResult = selectedTaskRunState.runResult;

  // Fetch latest run on task select
  useEffect(() => {
    if (!selectedTaskId || !selectedRepoId) return;
    void (async () => {
      try {
        const payload = await api<{ run: ActiveRun | null; events: RunEvent[] }>(
          `/api/runs/latest?taskId=${encodeURIComponent(selectedTaskId)}`,
        );
        const run = payload.run;
        if (!run) return;
        updateTaskRunState(selectedTaskId, (prev) => ({
          ...prev, activeRun: run,
          runResult: { run, events: payload.events, artifactPath: "" },
          runFinished: run.status !== "running",
        }));
        if (run.status === "running") {
          streamRef.current?.attachRunLogStream(run.id, selectedTaskId, selectedRepoId);
        }
      } catch { /* best-effort */ }
    })();
  }, [selectedTaskId, selectedRepoId, updateTaskRunState, streamRef]);

  // Cleanup streams on unmount
  useEffect(() => {
    return () => {
      streamRef.current?.closeAllRunStreams();
      streamRef.current?.closeAllPlanStreams();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [customBranchName, setCustomBranchName] = useState("");

  const startRun = useCallback(async () => {
    if (!selectedTaskId || !selectedTask) { setError("Select a task first."); return; }
    if (!selectedProfileId) { setError("Select an agent/model for this repo first."); return; }
    if (selectedTask.require_plan && !approvedPlan) { setError("Plan must be approved to start a run for this task."); return; }

    const taskId = selectedTaskId;
    const repoIdForRefresh = selectedRepoId;
    const body: Record<string, string> = { profileId: selectedProfileId };
    if (approvedPlan) body.planId = approvedPlan.id;
    if (!approvedPlan) body.taskId = taskId;
    if (customBranchName.trim()) body.branchName = customBranchName.trim();

    setBusy(true); setError("");
    updateTaskRunState(taskId, (prev) => ({ ...prev, runLogs: [], runFinished: false, runResult: null }));
    try {
      const payload = await api<{ run: { id: string; status: string; branch_name: string; agent?: RunAgent } }>("/api/runs/start", {
        method: "POST", body: JSON.stringify(body),
      });
      updateTaskRunState(taskId, (prev) => ({ ...prev, activeRun: payload.run }));
      setCustomBranchName("");
      setBusy(false);
      setInfo("Run started. Streaming logs...");
      if (repoIdForRefresh) {
        try { const t = await api<{ tasks: Task[] }>(`/api/tasks?repoId=${encodeURIComponent(repoIdForRefresh)}`); setTasks(t.tasks); } catch { /* ignore */ }
      }
      streamRef.current?.attachRunLogStream(payload.run.id, taskId, repoIdForRefresh);
    } catch (e) {
      if (repoIdForRefresh) {
        try { const t = await api<{ tasks: Task[] }>(`/api/tasks?repoId=${encodeURIComponent(repoIdForRefresh)}`); setTasks(t.tasks); } catch { /* ignore */ }
      }
      setError((e as Error).message); setBusy(false);
    }
  }, [selectedTaskId, selectedTask, selectedProfileId, approvedPlan, selectedRepoId, customBranchName, updateTaskRunState, streamRef, setTasks, setError, setInfo, setBusy]);

  const stopRun = useCallback(async () => {
    if (!selectedTaskId || !activeRun) return;
    try {
      await api(`/api/runs/${activeRun.id}/stop`, { method: "POST" });
      updateTaskRunState(selectedTaskId, (prev) => ({
        ...prev, activeRun: prev.activeRun ? { ...prev.activeRun, status: "cancelled" } : prev.activeRun, runFinished: true,
      }));
      streamRef.current?.closeAllRunStreams();
      if (selectedRepoId) {
        const t = await api<{ tasks: Task[] }>(`/api/tasks?repoId=${encodeURIComponent(selectedRepoId)}`);
        setTasks(t.tasks);
      }
      setInfo("Run cancelled.");
    } catch (e) { setError((e as Error).message); }
  }, [selectedTaskId, activeRun, selectedRepoId, updateTaskRunState, streamRef, setTasks, setError, setInfo]);

  return {
    taskRunStates, updateTaskRunState,
    activeRun, runLogs, runFinished, runResult,
    startRun, stopRun,
    customBranchName, setCustomBranchName,
  };
}
