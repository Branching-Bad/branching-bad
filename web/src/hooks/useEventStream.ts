import { useRef, useCallback } from "react";
import { api } from "../api";
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
  const eventSourcesRef = useRef<Map<string, EventSource>>(new Map());
  const planEventSourcesRef = useRef<Map<string, EventSource>>(new Map());
  const runTaskIndexRef = useRef<Map<string, string>>(new Map());
  const planJobTaskIndexRef = useRef<Map<string, string>>(new Map());

  const closeAllRunStreams = useCallback(() => {
    for (const source of eventSourcesRef.current.values()) {
      source.close();
    }
    eventSourcesRef.current.clear();
    runTaskIndexRef.current.clear();
  }, []);

  const closeAllPlanStreams = useCallback(() => {
    for (const source of planEventSourcesRef.current.values()) {
      source.close();
    }
    planEventSourcesRef.current.clear();
    planJobTaskIndexRef.current.clear();
  }, []);

  const attachRunLogStream = useCallback(
    (runId: string, taskId: string, repoIdForRefresh: string) => {
      if (eventSourcesRef.current.has(runId)) return;

      const es = new EventSource(`/api/runs/${runId}/logs`);
      eventSourcesRef.current.set(runId, es);
      runTaskIndexRef.current.set(runId, taskId);

      for (const evtType of ["stdout", "stderr", "thinking", "agent_text", "tool_use", "tool_result", "db_event"] as const) {
        es.addEventListener(evtType, (event) => {
          const data = (event as MessageEvent).data;
          updateTaskRunState(taskId, (prev) => ({
            ...prev,
            runLogs: [...prev.runLogs, { type: evtType, data }],
          }));
        });
      }

      es.addEventListener("finished", (event) => {
        let finishedStatus = "done";
        try {
          const data = JSON.parse((event as MessageEvent).data) as { status?: string };
          if (data.status) finishedStatus = data.status;
        } catch { /* ignore */ }

        updateTaskRunState(taskId, (prev) => ({
          ...prev,
          runFinished: true,
          activeRun: prev.activeRun ? { ...prev.activeRun, status: finishedStatus } : prev.activeRun,
        }));

        es.close();
        eventSourcesRef.current.delete(runId);
        runTaskIndexRef.current.delete(runId);

        if (repoIdForRefresh) {
          api<{ tasks: Task[] }>(`/api/tasks?repoId=${encodeURIComponent(repoIdForRefresh)}`)
            .then((tasksPayload) => setTasks(tasksPayload.tasks))
            .catch(() => {});
        }

        api<{ run: RunResponse["run"]; events: RunEvent[] }>(`/api/runs/${runId}`)
          .then((runPayload) => {
            updateTaskRunState(taskId, (prev) => ({
              ...prev,
              activeRun: runPayload.run,
              runResult: { run: runPayload.run, events: runPayload.events, artifactPath: "" },
              runFinished: runPayload.run.status !== "running",
            }));
          })
          .catch(() => {});

        api<{ reviewComments: ReviewComment[] }>(`/api/tasks/${encodeURIComponent(taskId)}/reviews`)
          .then((payload) => setReviewComments(payload.reviewComments))
          .catch(() => {});

        setInfo("Run finished.");
      });

      es.onerror = () => {
        updateTaskRunState(taskId, (prev) => ({ ...prev, runFinished: true }));
        es.close();
        eventSourcesRef.current.delete(runId);
        runTaskIndexRef.current.delete(runId);
      };
    },
    [updateTaskRunState, setTasks, setReviewComments, setInfo],
  );

  const attachPlanLogStream = useCallback(
    (jobId: string, taskId: string, repoIdForRefresh: string) => {
      if (planEventSourcesRef.current.has(jobId)) return;

      const es = new EventSource(`/api/plans/jobs/${jobId}/logs`);
      planEventSourcesRef.current.set(jobId, es);
      planJobTaskIndexRef.current.set(jobId, taskId);

      for (const evtType of ["stdout", "stderr", "thinking", "agent_text", "tool_use", "tool_result", "db_event"] as const) {
        es.addEventListener(evtType, (event) => {
          const data = (event as MessageEvent).data;
          updateTaskPlanState(taskId, (prev) => ({
            ...prev,
            planLogs: [...prev.planLogs, { type: evtType, data }],
          }));
        });
      }

      es.addEventListener("finished", (event) => {
        let finishedStatus = "done";
        try {
          const data = JSON.parse((event as MessageEvent).data) as { status?: string };
          if (data.status) finishedStatus = data.status;
        } catch {
          // ignore parse errors
        }

        updateTaskPlanState(taskId, (prev) => ({
          ...prev,
          planFinished: true,
          activeJob: prev.activeJob ? { ...prev.activeJob, status: finishedStatus } : prev.activeJob,
        }));

        es.close();
        planEventSourcesRef.current.delete(jobId);
        planJobTaskIndexRef.current.delete(jobId);

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

        if (repoIdForRefresh) {
          api<{ tasks: Task[] }>(`/api/tasks?repoId=${encodeURIComponent(repoIdForRefresh)}`)
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
                    attachRunLogStream(run.id, taskId, repoIdForRefresh);
                  }
                })
                .catch(() => pollForRun(attempt + 1));
            }, attempt === 0 ? 500 : 2000);
          };
          pollForRun(0);
        }
      });

      es.onerror = () => {
        updateTaskPlanState(taskId, (prev) => ({ ...prev, planFinished: true }));
        es.close();
        planEventSourcesRef.current.delete(jobId);
        planJobTaskIndexRef.current.delete(jobId);
      };
    },
    [selectedTaskIdRef, updateTaskPlanState, updateTaskRunState, attachRunLogStream, setPlans, setTasks],
  );

  return {
    attachRunLogStream,
    attachPlanLogStream,
    closeAllRunStreams,
    closeAllPlanStreams,
    eventSourcesRef,
  };
}
