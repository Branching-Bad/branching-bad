import { useEffect, useMemo, useState, useCallback, useRef } from "react";
import type { FormEvent } from "react";
import { api } from "./api";
import type {
  Repo, AgentProfile, Task, Plan, PlanJob, ReviewComment,
  ProviderMeta, LaneKey,
  TaskRunState, TaskPlanState, ActiveRun, RunEvent, RunAgent,
} from "./types";
import { EMPTY_TASK_RUN_STATE, EMPTY_TASK_PLAN_STATE } from "./types";
import { laneFromStatus, btnSecondary } from "./components/shared";
import { IconSettings, IconExtensions } from "./components/icons";
import { SettingsModal } from "./components/SettingsModal";
import { ExtensionsDrawer } from "./components/ExtensionsDrawer";
import { CreateTaskModal } from "./components/CreateTaskModal";
import { EditTaskModal } from "./components/EditTaskModal";
import { KanbanBoard } from "./components/KanbanBoard";
import { DetailsSidebar } from "./components/DetailsSidebar";
import { initProviders } from "./providers/init";
import { useEventStream } from "./hooks/useEventStream";
import { usePolling } from "./hooks/usePolling";

// Register all provider UIs (Jira, Sentry, etc.)
initProviders();

export default function App() {
  const [repos, setRepos] = useState<Repo[]>([]);
  const [agentProfiles, setAgentProfiles] = useState<AgentProfile[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [plans, setPlans] = useState<Plan[]>([]);

  const [selectedRepoId, setSelectedRepoId] = useState("");
  const [selectedProfileId, setSelectedProfileId] = useState("");
  const [selectedTaskId, setSelectedTaskId] = useState("");

  const [repoPath, setRepoPath] = useState("");
  const [repoName, setRepoName] = useState("");
  const [planComment, setPlanComment] = useState("");

  const [error, setError] = useState("");
  const [info, setInfo] = useState("");
  const [busy, setBusy] = useState(false);
  const [applyConflicts, setApplyConflicts] = useState<string[]>([]);
  const [taskRunStates, setTaskRunStates] = useState<Record<string, TaskRunState>>({});
  const [taskPlanStates, setTaskPlanStates] = useState<Record<string, TaskPlanState>>({});
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [extensionsOpen, setExtensionsOpen] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [detailsTab, setDetailsTab] = useState<"plan" | "tasklist" | "run" | "review">("plan");
  const [createTaskModalOpen, setCreateTaskModalOpen] = useState(false);
  const [editTaskModalOpen, setEditTaskModalOpen] = useState(false);
  const [newTaskTitle, setNewTaskTitle] = useState("");
  const [newTaskDesc, setNewTaskDesc] = useState("");
  const [newTaskPriority, setNewTaskPriority] = useState("");
  const [newTaskRequirePlan, setNewTaskRequirePlan] = useState(true);
  const [newTaskAutoApprovePlan, setNewTaskAutoApprovePlan] = useState(false);
  const [newTaskAutoStart, setNewTaskAutoStart] = useState(false);
  const [newTaskUseWorktree, setNewTaskUseWorktree] = useState(true);
  const [editTaskTitle, setEditTaskTitle] = useState("");
  const [editTaskDesc, setEditTaskDesc] = useState("");
  const [editTaskPriority, setEditTaskPriority] = useState("");
  const [editTaskRequirePlan, setEditTaskRequirePlan] = useState(true);
  const [editTaskAutoApprovePlan, setEditTaskAutoApprovePlan] = useState(false);
  const [editTaskAutoStart, setEditTaskAutoStart] = useState(false);
  const [editTaskUseWorktree, setEditTaskUseWorktree] = useState(true);
  const [selectedPlanId, setSelectedPlanId] = useState("");
  const [reviewComments, setReviewComments] = useState<ReviewComment[]>([]);
  const [reviewText, setReviewText] = useState("");
  const [manualPlanMarkdown, setManualPlanMarkdown] = useState("");
  const [manualPlanJsonText, setManualPlanJsonText] = useState("");
  const [manualTasklistJsonText, setManualTasklistJsonText] = useState("");
  const [tasklistValidationError, setTasklistValidationError] = useState("");

  // Provider state
  const [providerMetas, setProviderMetas] = useState<ProviderMeta[]>([]);
  const [providerItemCounts, setProviderItemCounts] = useState<Record<string, number>>({});

  const selectedTask = useMemo(() => tasks.find((t) => t.id === selectedTaskId) ?? null, [tasks, selectedTaskId]);
  const latestPlan = plans[0] ?? null;
  const selectedPlan = useMemo(
    () => plans.find((plan) => plan.id === selectedPlanId) ?? latestPlan,
    [plans, selectedPlanId, latestPlan],
  );
  const approvedPlan = useMemo(
    () => plans.find((plan) => plan.status === "approved") ?? null,
    [plans],
  );
  const taskRequiresPlan = selectedTask?.require_plan ?? true;
  const selectedTaskRunState = selectedTaskId
    ? (taskRunStates[selectedTaskId] ?? EMPTY_TASK_RUN_STATE)
    : EMPTY_TASK_RUN_STATE;
  const selectedTaskPlanState = selectedTaskId
    ? (taskPlanStates[selectedTaskId] ?? EMPTY_TASK_PLAN_STATE)
    : EMPTY_TASK_PLAN_STATE;
  const activeRun = selectedTaskRunState.activeRun;
  const runLogs = selectedTaskRunState.runLogs;
  const runFinished = selectedTaskRunState.runFinished;
  const runResult = selectedTaskRunState.runResult;
  const activePlanJob = selectedTaskPlanState.activeJob;
  const planLogs = selectedTaskPlanState.planLogs;
  const planFinished = selectedTaskPlanState.planFinished;
  const groupedTasks = useMemo(
    () => tasks.reduce<Record<LaneKey, Task[]>>(
      (acc, task) => { acc[laneFromStatus(task.status)].push(task); return acc; },
      { todo: [], inprogress: [], inreview: [], done: [], archived: [] },
    ),
    [tasks],
  );
  const selectedProfile = useMemo(
    () => agentProfiles.find((p) => p.id === selectedProfileId) ?? null,
    [agentProfiles, selectedProfileId],
  );
  const selectedRepo = useMemo(() => repos.find((r) => r.id === selectedRepoId) ?? null, [repos, selectedRepoId]);
  const totalProviderItemCount = Object.values(providerItemCounts).reduce((a, b) => a + b, 0);

  const updateTaskRunState = useCallback(
    (taskId: string, updater: (current: TaskRunState) => TaskRunState) => {
      setTaskRunStates((prev) => {
        const current = prev[taskId] ?? EMPTY_TASK_RUN_STATE;
        return { ...prev, [taskId]: updater(current) };
      });
    },
    [],
  );

  const updateTaskPlanState = useCallback(
    (taskId: string, updater: (current: TaskPlanState) => TaskPlanState) => {
      setTaskPlanStates((prev) => {
        const current = prev[taskId] ?? EMPTY_TASK_PLAN_STATE;
        return { ...prev, [taskId]: updater(current) };
      });
    },
    [],
  );

  const selectedTaskIdRef = useRef(selectedTaskId);
  selectedTaskIdRef.current = selectedTaskId;

  const {
    attachRunLogStream, attachPlanLogStream,
    closeAllRunStreams, closeAllPlanStreams,
    eventSourcesRef,
  } = useEventStream({
    updateTaskRunState,
    updateTaskPlanState,
    setTasks,
    setPlans,
    setReviewComments,
    setInfo,
    selectedTaskIdRef,
  });

  // ── Bootstrap ──
  const bootstrap = useCallback(async () => {
    try {
      const payload = await api<{
        repos: Repo[];
        agentProfiles: AgentProfile[];
        providers?: ProviderMeta[];
        providerItemCounts?: Record<string, number>;
      }>("/api/bootstrap");
      setRepos(payload.repos);
      setAgentProfiles(payload.agentProfiles ?? []);
      if (payload.providers) setProviderMetas(payload.providers);
      if (payload.providerItemCounts) setProviderItemCounts(payload.providerItemCounts);
      if (!selectedRepoId && payload.repos.length > 0) setSelectedRepoId(payload.repos[0].id);
    } catch (e) { setError((e as Error).message); }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => { void bootstrap(); }, [bootstrap]);

  useEffect(() => {
    closeAllRunStreams();
    closeAllPlanStreams();
    setTaskRunStates({});
    setTaskPlanStates({});
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
  }, [selectedRepoId, closeAllRunStreams, closeAllPlanStreams]);

  useEffect(() => {
    if (!selectedTaskId) {
      setPlans([]); setSelectedPlanId(""); setManualPlanMarkdown("");
      setManualPlanJsonText(""); setManualTasklistJsonText("");
      setTasklistValidationError(""); setReviewComments([]);
      return;
    }
    void (async () => {
      try {
        const [planPayload, reviewPayload] = await Promise.all([
          api<{ plans: Plan[] }>(`/api/plans?taskId=${encodeURIComponent(selectedTaskId)}`),
          api<{ reviewComments: ReviewComment[] }>(`/api/tasks/${encodeURIComponent(selectedTaskId)}/reviews`),
        ]);
        setPlans(planPayload.plans);
        const latest = planPayload.plans[0] ?? null;
        setSelectedPlanId(latest?.id ?? "");
        setManualPlanMarkdown(latest?.plan_markdown ?? "");
        setManualPlanJsonText(latest ? JSON.stringify(latest.plan ?? {}, null, 2) : "{}");
        setManualTasklistJsonText(latest ? JSON.stringify(latest.tasklist ?? {}, null, 2) : "{}");
        setTasklistValidationError("");
        setReviewComments(reviewPayload.reviewComments);
      } catch (e) { setError((e as Error).message); }
    })();
  }, [selectedTaskId]);

  // Polling: tasks
  const pollTasks = useCallback(() => {
    if (!selectedRepoId) return;
    api<{ tasks: Task[] }>(`/api/tasks?repoId=${encodeURIComponent(selectedRepoId)}`)
      .then((payload) => setTasks(payload.tasks))
      .catch(() => {});
  }, [selectedRepoId]);
  usePolling(pollTasks, 4000, !!selectedRepoId);

  // Polling: plans
  const pollPlans = useCallback(() => {
    if (!selectedTaskId) return;
    api<{ plans: Plan[] }>(`/api/plans?taskId=${encodeURIComponent(selectedTaskId)}`)
      .then((payload) => setPlans(payload.plans))
      .catch(() => {});
  }, [selectedTaskId]);
  usePolling(pollPlans, 4000, detailsOpen && !!selectedTaskId);

  // Polling: plan jobs
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
          attachPlanLogStream(job.id, selectedTaskId, selectedRepoId);
        }
      })
      .catch(() => {});
  }, [selectedTaskId, selectedRepoId, updateTaskPlanState, attachPlanLogStream]);
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
          attachPlanLogStream(job.id, selectedTaskId, selectedRepoId);
        }
      } catch { /* best-effort */ }
    })();
  }, [selectedTaskId, selectedRepoId, updateTaskPlanState, attachPlanLogStream]);

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
          attachRunLogStream(run.id, selectedTaskId, selectedRepoId);
        }
      } catch { /* best-effort */ }
    })();
  }, [selectedTaskId, selectedRepoId, updateTaskRunState, attachRunLogStream]);

  // Cleanup EventSource on unmount
  useEffect(() => {
    return () => { closeAllRunStreams(); closeAllPlanStreams(); };
  }, [closeAllRunStreams, closeAllPlanStreams]);

  useEffect(() => { if (!selectedTask) setDetailsOpen(false); }, [selectedTask]);

  // Auto-switch to review tab only when task ID changes
  const prevSelectedTaskIdRef = useRef("");
  useEffect(() => {
    if (selectedTaskId === prevSelectedTaskIdRef.current) return;
    prevSelectedTaskIdRef.current = selectedTaskId;
    if (!selectedTaskId) return;
    const task = tasks.find((t) => t.id === selectedTaskId);
    if (task?.status === "IN_REVIEW") setDetailsTab("review");
    else if (detailsTab === "review") setDetailsTab("run");
  }, [selectedTaskId, tasks]);

  useEffect(() => {
    if (!selectedPlan) return;
    setManualPlanMarkdown(selectedPlan.plan_markdown ?? "");
    setManualPlanJsonText(JSON.stringify(selectedPlan.plan ?? {}, null, 2));
    setManualTasklistJsonText(JSON.stringify(selectedPlan.tasklist ?? {}, null, 2));
    setTasklistValidationError("");
  }, [selectedPlan?.id]);

  useEffect(() => {
    if (!detailsOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setDetailsOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [detailsOpen]);

  // ── Business Logic ──

  const statusFromLane = (lane: LaneKey): string => {
    switch (lane) {
      case "todo": return "To Do";
      case "inprogress": return "In Progress";
      case "inreview": return "In Review";
      case "done": return "Done";
      case "archived": return "ARCHIVED";
    }
  };

  async function onRepoSubmit(event: FormEvent) {
    event.preventDefault(); setError(""); setInfo(""); setBusy(true);
    try {
      await api("/api/repos", { method: "POST", body: JSON.stringify({ path: repoPath, name: repoName || undefined }) });
      setRepoPath(""); setRepoName("");
      setInfo("Repository saved.");
      await bootstrap();
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }

  async function discoverAgents() {
    setError(""); setInfo(""); setBusy(true);
    try {
      const payload = await api<{ profiles: AgentProfile[]; synced: number }>("/api/agents/discover");
      setAgentProfiles(payload.profiles);
      setInfo(`${payload.synced} agent profiles updated.`);
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }

  async function saveAgentSelection() {
    if (!selectedRepoId || !selectedProfileId) { setError("Repo and agent profile required."); return; }
    setError(""); setInfo(""); setBusy(true);
    try {
      await api("/api/agents/select", { method: "POST", body: JSON.stringify({ repoId: selectedRepoId, profileId: selectedProfileId }) });
      setInfo("Agent profile saved for repo.");
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }

  const refreshTasks = useCallback(async () => {
    if (!selectedRepoId) return;
    try {
      const payload = await api<{ tasks: Task[] }>(`/api/tasks?repoId=${encodeURIComponent(selectedRepoId)}`);
      setTasks(payload.tasks);
    } catch { /* silent */ }
  }, [selectedRepoId]);

  async function createPlan(revisionComment?: string) {
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
        attachPlanLogStream(job.id, selectedTaskId, selectedRepoId);
      }
      setPlanComment("");
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }

  async function planAction(action: "approve" | "reject" | "revise") {
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
        const t = await api<{ tasks: Task[] }>(`/api/tasks?repoId=${encodeURIComponent(selectedRepoId)}`);
        setTasks(t.tasks);
      }
      setInfo(`Plan action: ${action}`);
      if (action !== "revise") setPlanComment("");
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }

  function validateTasklistDraft(): { ok: true; planJson: unknown; tasklistJson: unknown } | { ok: false; error: string } {
    let planJson: unknown;
    let tasklistJson: unknown;
    try { planJson = JSON.parse(manualPlanJsonText); } catch { return { ok: false, error: "Plan JSON is invalid." }; }
    try { tasklistJson = JSON.parse(manualTasklistJsonText); } catch { return { ok: false, error: "Tasklist JSON is invalid." }; }
    if (!tasklistJson || typeof tasklistJson !== "object") return { ok: false, error: "Tasklist JSON must be an object." };
    const phases = (tasklistJson as { phases?: unknown }).phases;
    if (!Array.isArray(phases)) return { ok: false, error: "Tasklist JSON must include `phases` array." };
    return { ok: true, planJson, tasklistJson };
  }

  async function saveManualRevision() {
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
  }

  async function startRun() {
    if (!selectedTaskId || !selectedTask) { setError("Select a task first."); return; }
    if (!selectedProfileId) { setError("Select an agent/model for this repo first."); return; }
    if (selectedTask.require_plan && !approvedPlan) { setError("Plan must be approved to start a run for this task."); return; }

    const taskId = selectedTaskId;
    const repoIdForRefresh = selectedRepoId;
    const body: Record<string, string> = { profileId: selectedProfileId };
    if (approvedPlan) body.planId = approvedPlan.id;
    if (!approvedPlan) body.taskId = taskId;

    setBusy(true); setError("");
    updateTaskRunState(taskId, (prev) => ({ ...prev, runLogs: [], runFinished: false, runResult: null }));
    try {
      const payload = await api<{ run: { id: string; status: string; branch_name: string; agent?: RunAgent } }>("/api/runs/start", {
        method: "POST", body: JSON.stringify(body),
      });
      updateTaskRunState(taskId, (prev) => ({ ...prev, activeRun: payload.run }));
      setBusy(false);
      setInfo("Run started. Streaming logs...");
      if (repoIdForRefresh) {
        try { const t = await api<{ tasks: Task[] }>(`/api/tasks?repoId=${encodeURIComponent(repoIdForRefresh)}`); setTasks(t.tasks); } catch { /* ignore */ }
      }
      attachRunLogStream(payload.run.id, taskId, repoIdForRefresh);
    } catch (e) {
      if (repoIdForRefresh) {
        try { const t = await api<{ tasks: Task[] }>(`/api/tasks?repoId=${encodeURIComponent(repoIdForRefresh)}`); setTasks(t.tasks); } catch { /* ignore */ }
      }
      setError((e as Error).message); setBusy(false);
    }
  }

  async function stopRun() {
    if (!selectedTaskId || !activeRun) return;
    try {
      await api(`/api/runs/${activeRun.id}/stop`, { method: "POST" });
      updateTaskRunState(selectedTaskId, (prev) => ({
        ...prev, activeRun: prev.activeRun ? { ...prev.activeRun, status: "cancelled" } : prev.activeRun, runFinished: true,
      }));
      const source = eventSourcesRef.current.get(activeRun.id);
      if (source) { source.close(); eventSourcesRef.current.delete(activeRun.id); }
      if (selectedRepoId) {
        const t = await api<{ tasks: Task[] }>(`/api/tasks?repoId=${encodeURIComponent(selectedRepoId)}`);
        setTasks(t.tasks);
      }
      setInfo("Run cancelled.");
    } catch (e) { setError((e as Error).message); }
  }

  async function submitReview() {
    if (!selectedTaskId || !reviewText.trim()) return;
    setError(""); setBusy(true);
    try {
      const payload = await api<{ reviewComment: ReviewComment; run: { id: string; status: string } }>(
        `/api/tasks/${encodeURIComponent(selectedTaskId)}/review`,
        { method: "POST", body: JSON.stringify({ comment: reviewText.trim() }) },
      );
      setReviewComments((prev) => [...prev, { ...payload.reviewComment, status: "processing", result_run_id: payload.run.id }]);
      setReviewText("");
      const reviewRunId = payload.run.id;
      updateTaskRunState(selectedTaskId, (prev) => ({
        ...prev, activeRun: { id: reviewRunId, status: "running", branch_name: prev.activeRun?.branch_name ?? "" },
        runLogs: [], runFinished: false, runResult: null,
      }));
      setDetailsTab("run");
      const pollForReviewRun = async () => {
        for (let i = 0; i < 20; i++) {
          try {
            const runData = await api<{ run: { id: string; status: string } }>(`/api/runs/${reviewRunId}`);
            if (runData.run) { attachRunLogStream(reviewRunId, selectedTaskId, selectedRepoId); return; }
          } catch { /* not ready yet */ }
          await new Promise((r) => setTimeout(r, 500));
        }
      };
      void pollForReviewRun();
      setInfo("Review feedback submitted. Agent is processing...");
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }

  async function markTaskDone() {
    if (!selectedTaskId) return;
    setError(""); setBusy(true);
    try {
      await api(`/api/tasks/${encodeURIComponent(selectedTaskId)}/complete`, { method: "POST" });
      if (selectedRepoId) { const t = await api<{ tasks: Task[] }>(`/api/tasks?repoId=${encodeURIComponent(selectedRepoId)}`); setTasks(t.tasks); }
      setInfo("Task marked as done.");
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }

  async function applyToMain() {
    if (!selectedTaskId) return;
    setError(""); setInfo(""); setBusy(true); setApplyConflicts([]);
    try {
      const res = await fetch(`/api/tasks/${encodeURIComponent(selectedTaskId)}/apply-to-main`, { method: "POST", headers: { "Content-Type": "application/json" } });
      const data = await res.json();
      if (res.status === 409 && data.conflict) { setApplyConflicts(data.conflictedFiles ?? []); }
      else if (res.ok && data.applied) { setApplyConflicts([]); setInfo(`Changes applied to ${data.baseBranch} as unstaged (${data.filesChanged} files).`); }
      else { setError(data.error ?? "Failed to apply changes."); }
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }

  async function requeueAutostart() {
    if (!selectedTask) return;
    setBusy(true); setError("");
    try {
      await api(`/api/tasks/${selectedTask.id}/autostart/requeue`, { method: "POST" });
      setInfo("Task requeued for autostart pipeline.");
      const payload = await api<{ tasks: Task[] }>(`/api/tasks?repoId=${encodeURIComponent(selectedRepoId)}`);
      setTasks(payload.tasks);
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }

  async function clearTaskPipeline() {
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
      const payload = await api<{ tasks: Task[] }>(`/api/tasks?repoId=${encodeURIComponent(selectedRepoId)}`);
      setTasks(payload.tasks);
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }

  async function clearAllPipelines() {
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
      const payload = await api<{ tasks: Task[] }>(`/api/tasks?repoId=${encodeURIComponent(selectedRepoId)}`);
      setTasks(payload.tasks);
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }

  async function createManualTask() {
    if (!selectedRepoId || !newTaskTitle.trim()) return;
    setBusy(true); setError("");
    try {
      await api("/api/tasks", {
        method: "POST",
        body: JSON.stringify({
          repoId: selectedRepoId, title: newTaskTitle.trim(),
          description: newTaskDesc.trim() || undefined, status: "To Do",
          priority: newTaskPriority || undefined, requirePlan: newTaskRequirePlan,
          autoApprovePlan: newTaskAutoApprovePlan, autoStart: newTaskAutoStart,
          useWorktree: newTaskUseWorktree,
        }),
      });
      const payload = await api<{ tasks: Task[] }>(`/api/tasks?repoId=${encodeURIComponent(selectedRepoId)}`);
      setTasks(payload.tasks);
      setNewTaskTitle(""); setNewTaskDesc(""); setNewTaskPriority("");
      setNewTaskRequirePlan(true); setNewTaskAutoApprovePlan(false); setNewTaskAutoStart(false); setNewTaskUseWorktree(true);
      setCreateTaskModalOpen(false);
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }

  function openEditTaskModal() {
    if (!selectedTask) return;
    setEditTaskTitle(selectedTask.title);
    setEditTaskDesc(selectedTask.description ?? "");
    setEditTaskPriority(selectedTask.priority ?? "");
    setEditTaskRequirePlan(selectedTask.require_plan);
    setEditTaskAutoApprovePlan(selectedTask.auto_approve_plan);
    setEditTaskAutoStart(selectedTask.auto_start);
    setEditTaskUseWorktree(selectedTask.use_worktree);
    setEditTaskModalOpen(true);
  }

  async function saveTaskEdits() {
    if (!selectedTask || !editTaskTitle.trim()) return;
    setBusy(true); setError("");
    try {
      const payload = await api<{ task: Task }>(`/api/tasks/${selectedTask.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          title: editTaskTitle.trim(), description: editTaskDesc.trim() || null,
          priority: editTaskPriority || null, requirePlan: editTaskRequirePlan,
          autoApprovePlan: editTaskAutoApprovePlan, autoStart: editTaskAutoStart,
          useWorktree: editTaskUseWorktree,
        }),
      });
      setTasks((prev) => prev.map((t) => t.id === payload.task.id ? payload.task : t));
      setEditTaskModalOpen(false);
      setInfo("Task updated.");
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }

  // ── Render ──
  return (
    <div className={`min-h-screen bg-surface-0 text-text-primary transition-[padding] duration-200 ${detailsOpen ? "lg:pr-[540px]" : ""}`}>
      {/* ─── Top Nav ─── */}
      <nav className="sticky top-0 z-40 border-b border-border-default bg-surface-0/95 backdrop-blur-md">
        <div className="mx-auto flex h-14 max-w-7xl items-center justify-between px-5">
          <div className="flex items-center gap-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-dark border border-brand-glow">
              <span className="text-sm font-bold text-brand">A</span>
            </div>
            <div className="flex items-center gap-2">
              <h1 className="text-sm font-semibold text-text-primary">Local Agent</h1>
              {selectedRepo && (
                <>
                  <span className="text-text-muted">/</span>
                  <span className="text-sm text-text-secondary">{selectedRepo.name}</span>
                </>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => void clearAllPipelines()} disabled={busy} className={`${btnSecondary} !px-3 !py-1.5 text-xs`} title="Clear all stuck pipelines">
              Clear Queue
            </button>
            <button
              onClick={() => setExtensionsOpen(true)}
              className="relative flex h-8 w-8 items-center justify-center rounded-md border border-border-strong bg-surface-300 text-text-muted transition hover:text-text-primary hover:border-border-strong"
              title="Extensions"
            >
              <IconExtensions />
              {totalProviderItemCount > 0 && (
                <span className="absolute -top-1.5 -right-1.5 inline-flex h-4 min-w-[16px] items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold text-white">
                  {totalProviderItemCount}
                </span>
              )}
            </button>
            <button onClick={() => setSettingsOpen(true)} className="flex h-8 w-8 items-center justify-center rounded-md border border-border-strong bg-surface-300 text-text-muted transition hover:text-text-primary hover:border-border-strong">
              <IconSettings />
            </button>
          </div>
        </div>
      </nav>

      {/* ─── Alerts ─── */}
      <div className="mx-auto max-w-7xl px-5">
        {error && !settingsOpen && (
          <div className="mt-4 rounded-lg border border-error-border bg-error-bg px-4 py-3 text-sm text-error-text">{error}</div>
        )}
        {info && !settingsOpen && (
          <div className="mt-4 rounded-lg border border-info-border bg-info-bg px-4 py-3 text-sm text-info-text">{info}</div>
        )}
      </div>

      {/* ─── Main Content ─── */}
      <main className="mx-auto max-w-7xl px-5 py-6">
        <KanbanBoard
          groupedTasks={groupedTasks}
          selectedTaskId={selectedTaskId}
          onSelectTask={(taskId) => { setSelectedTaskId(taskId); setDetailsOpen(true); setDetailsTab("plan"); }}
          onCreateTask={() => {
            setNewTaskTitle(""); setNewTaskDesc(""); setNewTaskPriority("");
            setNewTaskRequirePlan(true); setNewTaskAutoApprovePlan(false); setNewTaskAutoStart(false);
            setCreateTaskModalOpen(true);
          }}
          selectedRepoId={selectedRepoId}
          statusFromLane={statusFromLane}
          setTasks={setTasks}
          onError={setError}
        />
      </main>

      {detailsOpen && selectedTask && (
        <DetailsSidebar
          selectedTask={selectedTask}
          plans={plans} selectedPlanId={selectedPlanId} setSelectedPlanId={setSelectedPlanId}
          latestPlan={latestPlan} approvedPlan={approvedPlan}
          activePlanJob={activePlanJob} planLogs={planLogs} planFinished={planFinished}
          activeRun={activeRun} runLogs={runLogs} runFinished={runFinished} runResult={runResult}
          selectedProfile={selectedProfile}
          taskRequiresPlan={taskRequiresPlan}
          selectedProfileId={selectedProfileId}
          detailsTab={detailsTab} setDetailsTab={setDetailsTab}
          planComment={planComment} setPlanComment={setPlanComment}
          manualPlanMarkdown={manualPlanMarkdown} setManualPlanMarkdown={setManualPlanMarkdown}
          manualPlanJsonText={manualPlanJsonText} setManualPlanJsonText={setManualPlanJsonText}
          manualTasklistJsonText={manualTasklistJsonText} setManualTasklistJsonText={setManualTasklistJsonText}
          tasklistValidationError={tasklistValidationError}
          reviewComments={reviewComments} reviewText={reviewText} setReviewText={setReviewText}
          applyConflicts={applyConflicts}
          busy={busy}
          onClose={() => setDetailsOpen(false)}
          onEditTask={openEditTaskModal}
          onDeleteTask={async () => {
            if (!window.confirm(`Delete task "${selectedTask.jira_issue_key} - ${selectedTask.title}"? This cannot be undone.`)) return;
            try {
              await api(`/api/tasks/${selectedTask.id}`, { method: "DELETE" });
              setDetailsOpen(false); setSelectedTaskId("");
              setTasks((prev) => prev.filter((t) => t.id !== selectedTask.id));
            } catch (err) { setError((err as Error).message); }
          }}
          onCreatePlan={() => void createPlan()}
          onPlanAction={(action) => void planAction(action)}
          onValidateTasklist={() => {
            const result = validateTasklistDraft();
            if (result.ok) { setTasklistValidationError(""); setInfo("Tasklist JSON is valid."); }
            else { setTasklistValidationError(result.error); }
          }}
          onSaveManualRevision={() => void saveManualRevision()}
          onStartRun={() => void startRun()}
          onStopRun={() => void stopRun()}
          onSubmitReview={() => void submitReview()}
          onApplyToMain={() => void applyToMain()}
          onMarkTaskDone={() => void markTaskDone()}
          onRequeueAutostart={() => void requeueAutostart()}
          onClearTaskPipeline={() => void clearTaskPipeline()}
        />
      )}

      <ExtensionsDrawer
        open={extensionsOpen}
        onClose={() => setExtensionsOpen(false)}
        selectedRepoId={selectedRepoId}
        providerMetas={providerMetas}
        providerItemCounts={providerItemCounts}
        busy={busy}
        onBusyChange={setBusy}
        onTasksRefresh={refreshTasks}
        onError={setError}
        onInfo={setInfo}
        onBootstrapRefresh={bootstrap}
      />

      <SettingsModal
        open={settingsOpen} onClose={() => setSettingsOpen(false)}
        repos={repos} agentProfiles={agentProfiles}
        selectedRepoId={selectedRepoId} setSelectedRepoId={setSelectedRepoId}
        selectedProfileId={selectedProfileId} setSelectedProfileId={setSelectedProfileId}
        selectedProfile={selectedProfile}
        busy={busy} error={error} info={info}
        onRepoSubmit={onRepoSubmit}
        discoverAgents={discoverAgents} saveAgentSelection={saveAgentSelection}
        repoPath={repoPath} setRepoPath={setRepoPath}
        repoName={repoName} setRepoName={setRepoName}
      />

      <CreateTaskModal
        open={createTaskModalOpen} onClose={() => setCreateTaskModalOpen(false)} busy={busy}
        title={newTaskTitle} setTitle={setNewTaskTitle}
        description={newTaskDesc} setDescription={setNewTaskDesc}
        priority={newTaskPriority} setPriority={setNewTaskPriority}
        requirePlan={newTaskRequirePlan} setRequirePlan={setNewTaskRequirePlan}
        autoApprovePlan={newTaskAutoApprovePlan} setAutoApprovePlan={setNewTaskAutoApprovePlan}
        autoStart={newTaskAutoStart} setAutoStart={setNewTaskAutoStart}
        useWorktree={newTaskUseWorktree} setUseWorktree={setNewTaskUseWorktree}
        onCreate={createManualTask} repoName={selectedRepo?.name ?? "selected repo"}
      />

      <EditTaskModal
        open={editTaskModalOpen} onClose={() => setEditTaskModalOpen(false)} busy={busy}
        title={editTaskTitle} setTitle={setEditTaskTitle}
        description={editTaskDesc} setDescription={setEditTaskDesc}
        priority={editTaskPriority} setPriority={setEditTaskPriority}
        requirePlan={editTaskRequirePlan} setRequirePlan={setEditTaskRequirePlan}
        autoApprovePlan={editTaskAutoApprovePlan} setAutoApprovePlan={setEditTaskAutoApprovePlan}
        autoStart={editTaskAutoStart} setAutoStart={setEditTaskAutoStart}
        useWorktree={editTaskUseWorktree} setUseWorktree={setEditTaskUseWorktree}
        onSave={saveTaskEdits}
      />
    </div>
  );
}
