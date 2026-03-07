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
  refreshTasks,
  setError, setInfo, setBusy,
}: {
  selectedTaskId: string;
  selectedRepoId: string;
  selectedProfileId: string;
  selectedTask: Task | null;
  approvedPlan: { id: string } | null;
  streamRef: React.RefObject<StreamFunctions | null>;
  refreshTasks: () => Promise<void>;
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
    const ref = streamRef;
    return () => {
      ref.current?.closeAllRunStreams();
      ref.current?.closeAllPlanStreams();
    };
  }, [streamRef]);

  const [customBranchName, setCustomBranchName] = useState("");

  const startRun = useCallback(async () => {
    if (!selectedTaskId || !selectedTask) { setError("Select a task first."); return; }
    if (!selectedProfileId) { setError("Select an agent/model for this repo first."); return; }
    if (selectedTask.require_plan && !approvedPlan) { setError("Plan must be approved to start a run for this task."); return; }

    const taskId = selectedTaskId;
    const repoIdForRefresh = selectedRepoId;
    const effectiveProfileId = selectedTask.agent_profile_id || selectedProfileId;
    const body: Record<string, string> = { profileId: effectiveProfileId };
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
      await refreshTasks();
      streamRef.current?.attachRunLogStream(payload.run.id, taskId, repoIdForRefresh);
    } catch (e) {
      await refreshTasks();
      setError((e as Error).message); setBusy(false);
    }
  }, [selectedTaskId, selectedTask, selectedProfileId, approvedPlan, selectedRepoId, customBranchName, updateTaskRunState, streamRef, refreshTasks, setError, setInfo, setBusy]);

  const resumeRun = useCallback(async () => {
    if (!selectedTaskId || !selectedTask) { setError("Select a task first."); return; }
    if (!selectedProfileId) { setError("Select an agent/model for this repo first."); return; }
    if (!activeRun?.agent_session_id) { setError("No previous session to resume."); return; }

    const taskId = selectedTaskId;
    const repoIdForRefresh = selectedRepoId;

    setBusy(true); setError("");
    updateTaskRunState(taskId, (prev) => ({ ...prev, runLogs: [], runFinished: false, runResult: null }));
    try {
      const effectiveProfileId = selectedTask.agent_profile_id || selectedProfileId;
      const payload = await api<{ run: { id: string; status: string; branch_name: string; agent?: RunAgent } }>("/api/runs/resume", {
        method: "POST", body: JSON.stringify({ taskId, profileId: effectiveProfileId }),
      });
      updateTaskRunState(taskId, (prev) => ({ ...prev, activeRun: payload.run }));
      setBusy(false);
      setInfo("Resuming previous session...");
      await refreshTasks();
      streamRef.current?.attachRunLogStream(payload.run.id, taskId, repoIdForRefresh);
    } catch (e) {
      await refreshTasks();
      setError((e as Error).message); setBusy(false);
    }
  }, [selectedTaskId, selectedTask, selectedProfileId, activeRun, selectedRepoId, updateTaskRunState, streamRef, refreshTasks, setError, setInfo, setBusy]);

  const stopRun = useCallback(async () => {
    if (!selectedTaskId || !activeRun) return;
    try {
      await api(`/api/runs/${activeRun.id}/stop`, { method: "POST" });
      updateTaskRunState(selectedTaskId, (prev) => ({
        ...prev, activeRun: prev.activeRun ? { ...prev.activeRun, status: "cancelled" } : prev.activeRun, runFinished: true,
      }));
      streamRef.current?.closeAllRunStreams();
      await refreshTasks();
      setInfo("Run cancelled.");
    } catch (e) { setError((e as Error).message); }
  }, [selectedTaskId, activeRun, updateTaskRunState, streamRef, refreshTasks, setError, setInfo]);

  return {
    taskRunStates, updateTaskRunState,
    activeRun, runLogs, runFinished, runResult,
    startRun, resumeRun, stopRun,
    customBranchName, setCustomBranchName,
  };
}
