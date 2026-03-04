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
  const [manualTasklistJsonText, setManualTasklistJsonText] = useState("");
  const [tasklistValidationError, setTasklistValidationError] = useState("");
  const [planActionInProgress, setPlanActionInProgress] = useState("");
  const [taskPlanStates, setTaskPlanStates] = useState<Record<string, TaskPlanState>>({});
  const [aiFeedback, setAiFeedback] = useState("");
  const [aiFeedbackParsed, setAiFeedbackParsed] = useState<{ verdict: string; comments: Array<{ category: string; severity: string; reason: string; suggestion: string }> } | null>(null);
  const [aiFeedbackLoading, setAiFeedbackLoading] = useState(false);
  const [aiFeedbackStreamText, setAiFeedbackStreamText] = useState("");
  const [aiFeedbackOpen, setAiFeedbackOpen] = useState(false);
  const [selectedFeedbackIndices, setSelectedFeedbackIndices] = useState<Set<number>>(new Set());
  const [reviewPlanProfileId, setReviewPlanProfileId] = useState("");

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
    // Always reset AI feedback when task changes
    setAiFeedback(""); setAiFeedbackParsed(null); setAiFeedbackOpen(false); setSelectedFeedbackIndices(new Set());

    if (!selectedTaskId) {
      setPlans([]); setSelectedPlanId(""); setManualPlanMarkdown("");
      setManualTasklistJsonText("");
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
        setManualTasklistJsonText(latest ? JSON.stringify(latest.tasklist ?? {}, null, 2) : "{}");
        setTasklistValidationError("");
      } catch (e) { setError((e as Error).message); }
    })();
  }, [selectedTaskId, setError]);

  // Load persisted outputs when task changes
  useEffect(() => {
    if (!selectedTaskId) return;
    void (async () => {
      try {
        const res = await api<{ outputs: { type: string; data: string }[] }>(
          `/api/tasks/${encodeURIComponent(selectedTaskId)}/outputs`,
        );
        if (res.outputs.length > 0) {
          updateTaskPlanState(selectedTaskId, (prev) => {
            // Only seed if no live logs yet
            if (prev.planLogs.length > 0) return prev;
            return { ...prev, planLogs: res.outputs.map((o) => ({ type: o.type, data: o.data })) };
          });
        }
      } catch { /* best-effort */ }
    })();
  }, [selectedTaskId, updateTaskPlanState]);

  // Sync manual fields when selected plan changes
  useEffect(() => {
    if (!selectedPlan) return;
    setManualPlanMarkdown(selectedPlan.plan_markdown ?? "");
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
    const labels: Record<string, string> = { approve: "Approving plan…", reject: "Rejecting plan…", revise: "Generating revised plan…" };
    setBusy(true); setError(""); setPlanActionInProgress(labels[action] ?? action);
    try {
      const result = await api<{ status: string; job?: PlanJob }>(`/api/plans/${latestPlan.id}/action`, { method: "POST", body: JSON.stringify({ action, comment: planComment || undefined }) });

      if (action === "revise" && result.job) {
        // Revision is now async via plan job — stream live output
        const job = result.job;
        updateTaskPlanState(selectedTaskId, (prev) => ({
          activeJob: job,
          planLogs: prev.activeJob?.id === job.id ? prev.planLogs : [],
          planFinished: job.status !== "running" && job.status !== "pending",
        }));
        setInfo("Plan revision started. Live output is streaming.");
        if (job.status === "running" || job.status === "pending") {
          streamRef.current?.attachPlanLogStream(job.id, selectedTaskId, selectedRepoId);
        }
        setPlanComment("");
      } else {
        const payload = await api<{ plans: Plan[] }>(`/api/plans?taskId=${encodeURIComponent(selectedTaskId)}`);
        setPlans(payload.plans);
        const latest = payload.plans[0] ?? null;
        setSelectedPlanId(latest?.id ?? "");
        if (latest) {
          setManualPlanMarkdown(latest.plan_markdown ?? "");
          setManualTasklistJsonText(JSON.stringify(latest.tasklist ?? {}, null, 2));
        }
        if (selectedRepoId) {
          const t = await api<{ tasks: import("../types").Task[] }>(`/api/tasks?repoId=${encodeURIComponent(selectedRepoId)}`);
          setTasks(t.tasks);
        }
        setInfo(`Plan action: ${action}`);
        setPlanComment("");
      }
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); setPlanActionInProgress(""); }
  }, [latestPlan, planComment, selectedTaskId, selectedRepoId, setTasks, updateTaskPlanState, streamRef, setError, setInfo, setBusy]);

  const validateTasklistDraft = useCallback((): { ok: true; tasklistJson: unknown } | { ok: false; error: string } => {
    let tasklistJson: unknown;
    try { tasklistJson = JSON.parse(manualTasklistJsonText); } catch { return { ok: false, error: "Tasklist JSON is invalid." }; }
    if (!tasklistJson || typeof tasklistJson !== "object") return { ok: false, error: "Tasklist JSON must be an object." };
    const phases = (tasklistJson as { phases?: unknown }).phases;
    if (!Array.isArray(phases)) return { ok: false, error: "Tasklist JSON must include `phases` array." };
    return { ok: true, tasklistJson };
  }, [manualTasklistJsonText]);

  const onValidateTasklist = useCallback(() => {
    const result = validateTasklistDraft();
    if (result.ok) { setTasklistValidationError(""); setInfo("Tasklist JSON is valid."); }
    else { setTasklistValidationError(result.error); }
  }, [validateTasklistDraft, setInfo]);

  const reviewPlan = useCallback(async (profileId: string) => {
    if (!latestPlan) { setError("Generate a plan first."); return; }
    if (!profileId) { setError("Select an agent profile for review."); return; }
    setAiFeedbackLoading(true); setAiFeedbackStreamText(""); setError("");
    try {
      const resp = await fetch(`/api/plans/${latestPlan.id}/review`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ profileId }),
      });
      if (!resp.ok) {
        const errText = await resp.text();
        throw new Error(errText || `HTTP ${resp.status}`);
      }
      const reader = resp.body?.getReader();
      if (!reader) throw new Error("No response stream");
      const decoder = new TextDecoder();
      let feedbackResult = "";
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.startsWith("data:")) continue;
          const jsonStr = line.slice(5).trim();
          if (!jsonStr) continue;
          try {
            const evt = JSON.parse(jsonStr);
            if (evt.type === "log") {
              setAiFeedbackStreamText(evt.text ?? "");
            } else if (evt.type === "done") {
              feedbackResult = evt.feedback ?? "";
            } else if (evt.type === "error") {
              throw new Error(evt.message ?? "Agent review failed");
            }
          } catch (parseErr) {
            if ((parseErr as Error).message?.includes("Agent review failed")) throw parseErr;
          }
        }
      }

      const raw = feedbackResult;
      setAiFeedback(raw);
      try {
        const jsonMatch = raw.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          const parsed = JSON.parse(jsonMatch[0]);
          if (parsed.verdict && Array.isArray(parsed.comments)) {
            setAiFeedbackParsed(parsed);
          } else { setAiFeedbackParsed(null); }
        } else { setAiFeedbackParsed(null); }
      } catch { setAiFeedbackParsed(null); }
      setAiFeedbackOpen(true);
      setSelectedFeedbackIndices(new Set());
    } catch (e) { setError((e as Error).message); } finally { setAiFeedbackLoading(false); setAiFeedbackStreamText(""); }
  }, [latestPlan, setError]);

  const toggleFeedbackIndex = useCallback((index: number) => {
    setSelectedFeedbackIndices((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index); else next.add(index);
      return next;
    });
  }, []);

  const useAiFeedbackAsRevision = useCallback(() => {
    if (aiFeedbackParsed && aiFeedbackParsed.comments.length > 0) {
      const indices = selectedFeedbackIndices.size > 0
        ? [...selectedFeedbackIndices].sort((a, b) => a - b)
        : aiFeedbackParsed.comments.map((_, i) => i);
      const lines = indices
        .filter((i) => i < aiFeedbackParsed.comments.length)
        .map((i, n) => {
          const c = aiFeedbackParsed.comments[i];
          return `${n + 1}. [${c.severity}/${c.category}] ${c.reason}\n   → ${c.suggestion}`;
        });
      setPlanComment(lines.join("\n\n"));
    } else {
      setPlanComment(aiFeedback);
    }
  }, [aiFeedback, aiFeedbackParsed, selectedFeedbackIndices]);

  const saveManualRevision = useCallback(async () => {
    if (!selectedPlan) { setError("Select a plan version first."); return; }
    const parsed = validateTasklistDraft();
    if (!parsed.ok) { setTasklistValidationError(parsed.error); return; }
    setTasklistValidationError(""); setBusy(true); setError(""); setPlanActionInProgress("Saving manual revision…");
    try {
      await api<{ plan: Plan }>(`/api/plans/${selectedPlan.id}/manual-revision`, {
        method: "POST",
        body: JSON.stringify({ planMarkdown: manualPlanMarkdown, tasklistJson: parsed.tasklistJson, comment: "Manual revision from UI" }),
      });
      const payload = await api<{ plans: Plan[] }>(`/api/plans?taskId=${encodeURIComponent(selectedTaskId)}`);
      setPlans(payload.plans);
      const latest = payload.plans[0] ?? null;
      setSelectedPlanId(latest?.id ?? "");
      if (latest) {
        setManualPlanMarkdown(latest.plan_markdown ?? "");
        setManualTasklistJsonText(JSON.stringify(latest.tasklist ?? {}, null, 2));
      }
      setInfo("Manual revision saved as a new plan version.");
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); setPlanActionInProgress(""); }
  }, [selectedPlan, manualPlanMarkdown, selectedTaskId, validateTasklistDraft, setError, setInfo, setBusy]);

  return {
    plans, setPlans,
    selectedPlanId, setSelectedPlanId,
    planComment, setPlanComment,
    manualPlanMarkdown, setManualPlanMarkdown,
    manualTasklistJsonText, setManualTasklistJsonText,
    tasklistValidationError,
    taskPlanStates, updateTaskPlanState,
    latestPlan, selectedPlan, approvedPlan,
    activePlanJob, planLogs, planFinished,
    planActionInProgress,
    createPlan, planAction, onValidateTasklist, saveManualRevision,
    aiFeedback, setAiFeedback, aiFeedbackParsed,
    aiFeedbackLoading, aiFeedbackStreamText,
    aiFeedbackOpen, setAiFeedbackOpen,
    reviewPlanProfileId, setReviewPlanProfileId,
    selectedFeedbackIndices, toggleFeedbackIndex,
    reviewPlan, useAiFeedbackAsRevision,
  };
}
