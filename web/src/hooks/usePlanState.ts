import { useState, useMemo, useCallback, useEffect } from "react";
import { api } from "../api";
import type { Plan, PlanJob, TaskPlanState } from "../types";
import { EMPTY_TASK_PLAN_STATE } from "../types";
import type { StreamFunctions } from "./streamTypes";
import { usePolling } from "./usePolling";

export function usePlanState({
  selectedTaskId,
  selectedRepoId,
  streamRef,
  detailsOpen,
  setError, setInfo, setBusy, setTasks,
}: {
  selectedTaskId: string;
  selectedRepoId: string;
  streamRef: React.RefObject<StreamFunctions | null>;
  detailsOpen: boolean;
  setError: (msg: string) => void;
  setInfo: (msg: string) => void;
  setBusy: (v: boolean) => void;
  setTasks: React.Dispatch<React.SetStateAction<import("../types").Task[]>>;
}) {
  const [plans, setPlans] = useState<Plan[]>([]);
  const [selectedPlanId, setSelectedPlanId] = useState("");
  const [planComment, setPlanComment] = useState("");
  const [manualPlanMarkdown, setManualPlanMarkdown] = useState("");
  const [manualPlanJsonText, setManualPlanJsonText] = useState("");
  const [manualTasklistJsonText, setManualTasklistJsonText] = useState("");
  const [tasklistValidationError, setTasklistValidationError] = useState("");
  const [taskPlanStates, setTaskPlanStates] = useState<Record<string, TaskPlanState>>({});

  const updateTaskPlanState = useCallback(
    (taskId: string, updater: (current: TaskPlanState) => TaskPlanState) => {
      setTaskPlanStates((prev) => {
        const current = prev[taskId] ?? EMPTY_TASK_PLAN_STATE;
        return { ...prev, [taskId]: updater(current) };
      });
    },
    [],
  );

  const latestPlan = plans[0] ?? null;
  const selectedPlan = useMemo(
    () => plans.find((plan) => plan.id === selectedPlanId) ?? latestPlan,
    [plans, selectedPlanId, latestPlan],
  );
  const approvedPlan = useMemo(
    () => plans.find((plan) => plan.status === "approved") ?? null,
    [plans],
  );
  const selectedTaskPlanState = selectedTaskId
    ? (taskPlanStates[selectedTaskId] ?? EMPTY_TASK_PLAN_STATE)
    : EMPTY_TASK_PLAN_STATE;
  const activePlanJob = selectedTaskPlanState.activeJob;
  const planLogs = selectedTaskPlanState.planLogs;
  const planFinished = selectedTaskPlanState.planFinished;

  // Load plans + reviews + chat when task changes
  useEffect(() => {
    if (!selectedTaskId) {
      setPlans([]); setSelectedPlanId(""); setManualPlanMarkdown("");
      setManualPlanJsonText(""); setManualTasklistJsonText("");
      setTasklistValidationError("");
      return;
    }
    void (async () => {
      try {
        const planPayload = await api<{ plans: Plan[] }>(`/api/plans?taskId=${encodeURIComponent(selectedTaskId)}`);
        setPlans(planPayload.plans);
        const latest = planPayload.plans[0] ?? null;
        setSelectedPlanId(latest?.id ?? "");
        setManualPlanMarkdown(latest?.plan_markdown ?? "");
        setManualPlanJsonText(latest ? JSON.stringify(latest.plan ?? {}, null, 2) : "{}");
        setManualTasklistJsonText(latest ? JSON.stringify(latest.tasklist ?? {}, null, 2) : "{}");
        setTasklistValidationError("");
      } catch (e) { setError((e as Error).message); }
    })();
  }, [selectedTaskId, setError]);

  // Sync manual fields when selected plan changes
  useEffect(() => {
    if (!selectedPlan) return;
    setManualPlanMarkdown(selectedPlan.plan_markdown ?? "");
    setManualPlanJsonText(JSON.stringify(selectedPlan.plan ?? {}, null, 2));
    setManualTasklistJsonText(JSON.stringify(selectedPlan.tasklist ?? {}, null, 2));
    setTasklistValidationError("");
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedPlan?.id]);

  // Plan polling
  const pollPlans = useCallback(() => {
    if (!selectedTaskId) return;
    api<{ plans: Plan[] }>(`/api/plans?taskId=${encodeURIComponent(selectedTaskId)}`)
      .then((payload) => setPlans(payload.plans))
      .catch(() => {});
  }, [selectedTaskId]);
  usePolling(pollPlans, 4000, detailsOpen && !!selectedTaskId);

  // Plan job polling
  const pollPlanJobs = useCallback(() => {
    if (!selectedTaskId) return;
    api<{ job: PlanJob | null }>(`/api/plans/jobs/latest?taskId=${encodeURIComponent(selectedTaskId)}`)
      .then((payload) => {
        const job = payload.job;
        if (!job) return;
        updateTaskPlanState(selectedTaskId, (prev) => ({
          ...prev,
          activeJob: job,
          planFinished: job.status !== "running" && job.status !== "pending",
        }));
        if (job.status === "running" || job.status === "pending") {
          streamRef.current?.attachPlanLogStream(job.id, selectedTaskId, selectedRepoId);
        }
      })
      .catch(() => {});
  }, [selectedTaskId, selectedRepoId, updateTaskPlanState, streamRef]);
  usePolling(pollPlanJobs, 4000, detailsOpen && !!selectedTaskId);

  // Fetch latest plan job on task select
  useEffect(() => {
    if (!selectedTaskId) return;
    void (async () => {
      try {
        const payload = await api<{ job: PlanJob | null }>(
          `/api/plans/jobs/latest?taskId=${encodeURIComponent(selectedTaskId)}`,
        );
        const job = payload.job;
        if (!job) {
          updateTaskPlanState(selectedTaskId, (prev) => ({ ...prev, activeJob: null, planFinished: true }));
          return;
        }
        updateTaskPlanState(selectedTaskId, (prev) => ({
          ...prev, activeJob: job,
          planFinished: job.status !== "running" && job.status !== "pending",
        }));
        if (job.status === "running" || job.status === "pending") {
          streamRef.current?.attachPlanLogStream(job.id, selectedTaskId, selectedRepoId);
        }
      } catch { /* best-effort */ }
    })();
  }, [selectedTaskId, selectedRepoId, updateTaskPlanState, streamRef]);

  const createPlan = useCallback(async (revisionComment?: string) => {
    if (!selectedTaskId) { setError("Select a task first."); return; }
    setBusy(true); setError("");
    try {
      const payload = await api<{ job: PlanJob }>("/api/plans/create", {
        method: "POST",
        body: JSON.stringify({ taskId: selectedTaskId, revisionComment }),
      });
      const job = payload.job;
      updateTaskPlanState(selectedTaskId, (prev) => ({
        activeJob: job,
        planLogs: prev.activeJob?.id === job.id ? prev.planLogs : [],
        planFinished: job.status !== "running" && job.status !== "pending",
      }));
      setInfo("Plan pipeline started. Live output is streaming.");
      if (job.status === "running" || job.status === "pending") {
        streamRef.current?.attachPlanLogStream(job.id, selectedTaskId, selectedRepoId);
      }
      setPlanComment("");
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }, [selectedTaskId, selectedRepoId, updateTaskPlanState, streamRef, setError, setInfo, setBusy]);

  const planAction = useCallback(async (action: "approve" | "reject" | "revise") => {
    if (!latestPlan) { setError("Generate a plan first."); return; }
    setBusy(true); setError("");
    try {
      await api(`/api/plans/${latestPlan.id}/action`, { method: "POST", body: JSON.stringify({ action, comment: planComment || undefined }) });
      const payload = await api<{ plans: Plan[] }>(`/api/plans?taskId=${encodeURIComponent(selectedTaskId)}`);
      setPlans(payload.plans);
      const latest = payload.plans[0] ?? null;
      setSelectedPlanId(latest?.id ?? "");
      if (latest) {
        setManualPlanMarkdown(latest.plan_markdown ?? "");
        setManualPlanJsonText(JSON.stringify(latest.plan ?? {}, null, 2));
        setManualTasklistJsonText(JSON.stringify(latest.tasklist ?? {}, null, 2));
      }
      if (selectedRepoId) {
        const t = await api<{ tasks: import("../types").Task[] }>(`/api/tasks?repoId=${encodeURIComponent(selectedRepoId)}`);
        setTasks(t.tasks);
      }
      setInfo(`Plan action: ${action}`);
      if (action !== "revise") setPlanComment("");
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }, [latestPlan, planComment, selectedTaskId, selectedRepoId, setTasks, setError, setInfo, setBusy]);

  const validateTasklistDraft = useCallback((): { ok: true; planJson: unknown; tasklistJson: unknown } | { ok: false; error: string } => {
    let planJson: unknown;
    let tasklistJson: unknown;
    try { planJson = JSON.parse(manualPlanJsonText); } catch { return { ok: false, error: "Plan JSON is invalid." }; }
    try { tasklistJson = JSON.parse(manualTasklistJsonText); } catch { return { ok: false, error: "Tasklist JSON is invalid." }; }
    if (!tasklistJson || typeof tasklistJson !== "object") return { ok: false, error: "Tasklist JSON must be an object." };
    const phases = (tasklistJson as { phases?: unknown }).phases;
    if (!Array.isArray(phases)) return { ok: false, error: "Tasklist JSON must include `phases` array." };
    return { ok: true, planJson, tasklistJson };
  }, [manualPlanJsonText, manualTasklistJsonText]);

  const onValidateTasklist = useCallback(() => {
    const result = validateTasklistDraft();
    if (result.ok) { setTasklistValidationError(""); setInfo("Tasklist JSON is valid."); }
    else { setTasklistValidationError(result.error); }
  }, [validateTasklistDraft, setInfo]);

  const saveManualRevision = useCallback(async () => {
    if (!selectedPlan) { setError("Select a plan version first."); return; }
    const parsed = validateTasklistDraft();
    if (!parsed.ok) { setTasklistValidationError(parsed.error); return; }
    setTasklistValidationError(""); setBusy(true); setError("");
    try {
      await api<{ plan: Plan }>(`/api/plans/${selectedPlan.id}/manual-revision`, {
        method: "POST",
        body: JSON.stringify({ planMarkdown: manualPlanMarkdown, planJson: parsed.planJson, tasklistJson: parsed.tasklistJson, comment: "Manual revision from UI" }),
      });
      const payload = await api<{ plans: Plan[] }>(`/api/plans?taskId=${encodeURIComponent(selectedTaskId)}`);
      setPlans(payload.plans);
      const latest = payload.plans[0] ?? null;
      setSelectedPlanId(latest?.id ?? "");
      if (latest) {
        setManualPlanMarkdown(latest.plan_markdown ?? "");
        setManualPlanJsonText(JSON.stringify(latest.plan ?? {}, null, 2));
        setManualTasklistJsonText(JSON.stringify(latest.tasklist ?? {}, null, 2));
      }
      setInfo("Manual revision saved as a new plan version.");
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }, [selectedPlan, manualPlanMarkdown, selectedTaskId, validateTasklistDraft, setError, setInfo, setBusy]);

  return {
    plans, setPlans,
    selectedPlanId, setSelectedPlanId,
    planComment, setPlanComment,
    manualPlanMarkdown, setManualPlanMarkdown,
    manualPlanJsonText, setManualPlanJsonText,
    manualTasklistJsonText, setManualTasklistJsonText,
    tasklistValidationError,
    taskPlanStates, updateTaskPlanState,
    latestPlan, selectedPlan, approvedPlan,
    activePlanJob, planLogs, planFinished,
    createPlan, planAction, onValidateTasklist, saveManualRevision,
  };
}
