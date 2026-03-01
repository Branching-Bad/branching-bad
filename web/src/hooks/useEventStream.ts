import { useRef, useCallback, useState, useEffect } from "react";
import { api } from "../api";
import { useWebSocketStream } from "./useWebSocketStream";
import type { Task, Plan, PlanJob, ActiveRun, RunEvent, TaskRunState, TaskPlanState, ReviewComment, RunResponse } from "../types";

export function useEventStream({
  updateTaskRunState,
  updateTaskPlanState,
  setTasks,
  setPlans,
  setReviewComments,
  setInfo,
  selectedTaskIdRef,
}: {
  updateTaskRunState: (taskId: string, updater: (current: TaskRunState) => TaskRunState) => void;
  updateTaskPlanState: (taskId: string, updater: (current: TaskPlanState) => TaskPlanState) => void;
  setTasks: React.Dispatch<React.SetStateAction<Task[]>>;
  setPlans: React.Dispatch<React.SetStateAction<Plan[]>>;
  setReviewComments: React.Dispatch<React.SetStateAction<ReviewComment[]>>;
  setInfo: (msg: string) => void;
  selectedTaskIdRef: React.RefObject<string>;
}) {
  // --- Run WS ---
  const [runWsUrl, setRunWsUrl] = useState<string | null>(null);
  const runMetaRef = useRef<{ runId: string; taskId: string; repoId: string } | null>(null);
  const runWs = useWebSocketStream(runWsUrl);
  const prevRunFinishedRef = useRef(false);

  // --- Plan WS ---
  const [planWsUrl, setPlanWsUrl] = useState<string | null>(null);
  const planMetaRef = useRef<{ jobId: string; taskId: string; repoId: string } | null>(null);
  const planWs = useWebSocketStream(planWsUrl);
  const prevPlanFinishedRef = useRef(false);

  // --- Callbacks (declared before effects that use them) ---
  const attachRunLogStream = useCallback(
    (runId: string, taskId: string, repoIdForRefresh: string) => {
      runMetaRef.current = { runId, taskId, repoId: repoIdForRefresh };
      prevRunFinishedRef.current = false;
      setRunWsUrl(`/api/runs/${runId}/ws`);
    },
    [],
  );

  const attachPlanLogStream = useCallback(
    (jobId: string, taskId: string, repoIdForRefresh: string) => {
      planMetaRef.current = { jobId, taskId, repoId: repoIdForRefresh };
      prevPlanFinishedRef.current = false;
      setPlanWsUrl(`/api/plans/jobs/${jobId}/ws`);
    },
    [],
  );

  const closeAllRunStreams = useCallback(() => {
    setRunWsUrl(null);
    runMetaRef.current = null;
  }, []);

  const closeAllPlanStreams = useCallback(() => {
    setPlanWsUrl(null);
    planMetaRef.current = null;
  }, []);

  // --- Run log forwarding ---
  useEffect(() => {
    const meta = runMetaRef.current;
    if (!meta) return;
    const { taskId } = meta;

    updateTaskRunState(taskId, (prev) => ({
      ...prev,
      runLogs: runWs.logs,
    }));
  }, [runWs.logs, updateTaskRunState]);

  // --- Run finished handling ---
  useEffect(() => {
    const meta = runMetaRef.current;
    if (!meta) return;
    if (!runWs.isFinished) {
      prevRunFinishedRef.current = false;
      return;
    }
    if (prevRunFinishedRef.current) return;
    prevRunFinishedRef.current = true;

    const { runId, taskId, repoId } = meta;

    let finishedStatus = "done";
    const finishedEntry = runWs.logs.find((e) => e.type === "finished");
    if (finishedEntry) {
      try {
        const data = JSON.parse(finishedEntry.data) as { status?: string };
        if (data.status) finishedStatus = data.status;
      } catch { /* ignore */ }
    }

    updateTaskRunState(taskId, (prev) => ({
      ...prev,
      runFinished: true,
      activeRun: prev.activeRun ? { ...prev.activeRun, status: finishedStatus } : prev.activeRun,
    }));

    if (repoId) {
      api<{ tasks: Task[] }>(`/api/tasks?repoId=${encodeURIComponent(repoId)}`)
        .then((payload) => setTasks(payload.tasks))
        .catch(() => {});
    }

    api<{ run: RunResponse["run"]; events: RunEvent[] }>(`/api/runs/${runId}`)
      .then((payload) => {
        updateTaskRunState(taskId, (prev) => ({
          ...prev,
          activeRun: payload.run,
          runResult: { run: payload.run, events: payload.events, artifactPath: "" },
          runFinished: payload.run.status !== "running",
        }));
      })
      .catch(() => {});

    api<{ reviewComments: ReviewComment[] }>(`/api/tasks/${encodeURIComponent(taskId)}/reviews`)
      .then((payload) => setReviewComments(payload.reviewComments))
      .catch(() => {});

    setInfo("Run finished.");
  }, [runWs.isFinished, runWs.logs, updateTaskRunState, setTasks, setReviewComments, setInfo]);

  // --- Plan log forwarding ---
  useEffect(() => {
    const meta = planMetaRef.current;
    if (!meta) return;
    const { taskId } = meta;

    updateTaskPlanState(taskId, (prev) => ({
      ...prev,
      planLogs: planWs.logs,
    }));
  }, [planWs.logs, updateTaskPlanState]);

  // --- Plan finished handling ---
  useEffect(() => {
    const meta = planMetaRef.current;
    if (!meta) return;
    if (!planWs.isFinished) {
      prevPlanFinishedRef.current = false;
      return;
    }
    if (prevPlanFinishedRef.current) return;
    prevPlanFinishedRef.current = true;

    const { jobId, taskId, repoId } = meta;

    let finishedStatus = "done";
    const finishedEntry = planWs.logs.find((e) => e.type === "finished");
    if (finishedEntry) {
      try {
        const data = JSON.parse(finishedEntry.data) as { status?: string };
        if (data.status) finishedStatus = data.status;
      } catch { /* ignore */ }
    }

    updateTaskPlanState(taskId, (prev) => ({
      ...prev,
      planFinished: true,
      activeJob: prev.activeJob ? { ...prev.activeJob, status: finishedStatus } : prev.activeJob,
    }));

    api<{ job: PlanJob }>(`/api/plans/jobs/${jobId}`)
      .then((payload) => {
        updateTaskPlanState(taskId, (prev) => ({
          ...prev,
          activeJob: payload.job,
          planFinished: payload.job.status !== "running" && payload.job.status !== "pending",
        }));
      })
      .catch(() => {});

    if (taskId === selectedTaskIdRef.current) {
      api<{ plans: Plan[] }>(`/api/plans?taskId=${encodeURIComponent(taskId)}`)
        .then((payload) => setPlans(payload.plans))
        .catch(() => {});
    }

    if (repoId) {
      api<{ tasks: Task[] }>(`/api/tasks?repoId=${encodeURIComponent(repoId)}`)
        .then((payload) => setTasks(payload.tasks))
        .catch(() => {});
    }

    // After plan finishes, check if an auto-started run exists and attach its log stream
    if (finishedStatus === "done") {
      const pollForRun = (attempt: number) => {
        if (attempt > 5) return;
        setTimeout(() => {
          api<{ run: ActiveRun | null; events: RunEvent[] }>(
            `/api/runs/latest?taskId=${encodeURIComponent(taskId)}`,
          )
            .then((payload) => {
              const run = payload.run;
              if (!run) {
                pollForRun(attempt + 1);
                return;
              }
              updateTaskRunState(taskId, (prev) => ({
                ...prev,
                activeRun: run,
                runLogs: [],
                runResult: {
                  run,
                  events: payload.events,
                  artifactPath: "",
                },
                runFinished: run.status !== "running",
              }));
              if (run.status === "running") {
                attachRunLogStream(run.id, taskId, repoId);
              }
            })
            .catch(() => pollForRun(attempt + 1));
        }, attempt === 0 ? 500 : 2000);
      };
      pollForRun(0);
    }
  }, [planWs.isFinished, planWs.logs, selectedTaskIdRef, updateTaskPlanState, updateTaskRunState, attachRunLogStream, setPlans, setTasks]);

  return {
    attachRunLogStream,
    attachPlanLogStream,
    closeAllRunStreams,
    closeAllPlanStreams,
  };
}
