import { useEffect, useState, useRef, useCallback } from "react";
import { api } from "./api";
import { btnSecondary } from "./components/shared";
import { IconSettings, IconExtensions, IconAnalyst } from "./components/icons";
import { SettingsModal } from "./components/SettingsModal";
import { ExtensionsDrawer } from "./components/ExtensionsDrawer";
import { CreateTaskModal } from "./components/CreateTaskModal";
import { EditTaskModal } from "./components/EditTaskModal";
import { KanbanBoard } from "./components/KanbanBoard";
import { DetailsSidebar } from "./components/DetailsSidebar";
import { DiffReviewModal } from "./components/DiffReviewModal";
import { PlanExpandModal } from "./components/PlanExpandModal";
import { TaskAnalystModal, TaskAnalystPanel } from "./components/TaskAnalystModal";
import { WorkflowTab } from "./components/WorkflowTab";
import { initProviders } from "./providers/init";
import { JiraSprintQuickSwitch } from "./providers/jira/JiraSprintQuickSwitch";
import { useEventStream } from "./hooks/useEventStream";
import { useBootstrap } from "./hooks/useBootstrap";
import { useRepoSelection } from "./hooks/useRepoSelection";
import { useTaskState } from "./hooks/useTaskState";
import { usePlanState } from "./hooks/usePlanState";
import { useRunState } from "./hooks/useRunState";
import { useReviewState } from "./hooks/useReviewState";
import { useChatState } from "./hooks/useChatState";
import { useRulesState } from "./hooks/useRulesState";
import { useMemoryState } from "./hooks/useMemoryState";
import { useGlossaryState } from "./hooks/useGlossaryState";
import { useAnalystState } from "./hooks/useAnalystState";
import { useGlobalRuns } from "./hooks/useGlobalRuns";
import { useToast } from "./hooks/useToast";
import { StatusBar } from "./components/StatusBar";
import { ThanosSnapFilter } from "./effects/thanos-snap";
import { ToastNotification } from "./components/ToastNotification";
import type { StreamFunctions } from "./hooks/streamTypes";

initProviders();

export default function App() {
  // ── UI State ──
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");
  const [busy, setBusy] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [extensionsOpen, setExtensionsOpen] = useState(false);
  const [reviewModalOpen, setReviewModalOpen] = useState(false);
  const [planModalOpen, setPlanModalOpen] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [detailsTab, setDetailsTab] = useState<"plan" | "tasklist" | "run" | "review">("plan");
  const [createTaskModalOpen, setCreateTaskModalOpen] = useState(false);
  const [editTaskModalOpen, setEditTaskModalOpen] = useState(false);
  const [analystOpen, setAnalystOpen] = useState(false);
  const [taskPrefill, setTaskPrefill] = useState<{ title: string; description: string } | null>(null);
  const [topTab, setTopTab] = useState<'board' | 'analyst' | 'workflow'>('board');

  // ── Stream function ref (breaks circular dep between hooks and useEventStream) ──
  useEffect(() => {
    if (!info) return;
    const timer = window.setTimeout(() => setInfo(""), 3000);
    return () => window.clearTimeout(timer);
  }, [info]);

  useEffect(() => {
    if (!error) return;
    const timer = window.setTimeout(() => setError(""), 5000);
    return () => window.clearTimeout(timer);
  }, [error]);

  const streamRef = useRef<StreamFunctions | null>(null);

  // ── Domain Hooks ──
  const boot = useBootstrap();
  const repo = useRepoSelection({
    repos: boot.repos, agentProfiles: boot.agentProfiles, setAgentProfiles: boot.setAgentProfiles,
    bootstrap: boot.bootstrap, setError, setInfo, setBusy,
  });
  const task = useTaskState({
    selectedRepoId: repo.selectedRepoId, streamRef,
    setSelectedProfileId: repo.setSelectedProfileId,
    setError, setInfo, setBusy,
  });
  const plan = usePlanState({
    selectedTaskId: task.selectedTaskId, selectedRepoId: repo.selectedRepoId,
    streamRef, detailsOpen, setError, setInfo, setBusy, refreshTasks: task.refreshTasks,
  });
  const run = useRunState({
    selectedTaskId: task.selectedTaskId, selectedRepoId: repo.selectedRepoId,
    selectedProfileId: repo.selectedProfileId, selectedTask: task.selectedTask,
    approvedPlan: plan.approvedPlan, streamRef,
    refreshTasks: task.refreshTasks, setError, setInfo, setBusy,
  });
  const review = useReviewState({
    selectedTaskId: task.selectedTaskId, selectedRepoId: repo.selectedRepoId,
    tasks: task.tasks, taskRunStates: run.taskRunStates, detailsTab,
    streamRef, updateTaskRunState: run.updateTaskRunState,
    refreshTasks: task.refreshTasks, setError, setInfo, setBusy, setDetailsTab,
  });
  const rulesState = useRulesState();
  const memoryState = useMemoryState();
  const glossaryState = useGlossaryState();
  const analyst = useAnalystState(repo.selectedRepoId);
  const chat = useChatState({
    selectedTaskId: task.selectedTaskId, selectedRepoId: repo.selectedRepoId,
    streamRef, updateTaskRunState: run.updateTaskRunState, setError,
  });
  const { toasts, addToast, dismissToast } = useToast();
  const { visibleRuns, exitingRunIds, cancelRun, resumeRun, removeRun } = useGlobalRuns({
    onRunFinished: (ev) => {
      addToast({
        type: ev.status === "done" ? "success" : "error",
        title: `${ev.taskTitle} ${ev.status === "done" ? "completed" : "failed"}`,
        taskId: ev.taskId,
        repoId: ev.repoId,
      });
      // Clear any pending conflict-resolution UI for the selected task — the
      // agent run finishing means markers have been addressed (or the run
      // failed; either way the stale modal should go away).
      if (ev.taskId === task.selectedTaskIdRef.current && review.applyConflicts.length > 0) {
        review.setApplyConflicts([]);
        if (ev.status === "done") {
          setInfo("Conflicts resolved — drag to Done again to finalize.");
        } else {
          setError("Conflict resolver failed. Check run logs or resolve manually.");
        }
      }
    },
    onTaskApplied: (ev) => {
      void task.refreshTasks();
      addToast({
        type: "success",
        title: `Changes applied to main (${ev.filesChanged} file${ev.filesChanged === 1 ? "" : "s"})`,
        taskId: ev.taskId,
        repoId: "",
      });
    },
  });
  const { selectedRepoId, setSelectedRepoId } = repo;
  const { setSelectedTaskId } = task;

  // ── Event Stream (bridges all domain hooks via WebSocket) ──
  const stream = useEventStream({
    updateTaskRunState: run.updateTaskRunState,
    updateTaskPlanState: plan.updateTaskPlanState,
    refreshTasks: task.refreshTasks,
    setPlans: plan.setPlans,
    setReviewComments: review.setReviewComments,
    setChatMessages: chat.setChatMessages,
    setInfo,
    selectedTaskIdRef: task.selectedTaskIdRef,
  });
  useEffect(() => { streamRef.current = stream; }, [stream]);

  // ── Navigate to task from StatusBar / Toast ──
  const handleRunNavigate = useCallback((taskId: string, repoId: string) => {
    if (repoId !== selectedRepoId) setSelectedRepoId(repoId);
    setSelectedTaskId(taskId);
    removeRun(taskId);
    setDetailsOpen(true);
    setDetailsTab("run");
  }, [selectedRepoId, setSelectedRepoId, setSelectedTaskId, removeRun]);

  // ── Auto-select first repo on bootstrap ──
  useEffect(() => { repo.initRepoId(boot.repos); }, [boot.repos, repo.initRepoId]);

  // ── Load rules when repo changes ──
  useEffect(() => { void rulesState.loadRules(repo.selectedRepoId || undefined); }, [repo.selectedRepoId, rulesState.loadRules]);

  // ── Load memories when repo changes ──
  useEffect(() => { if (repo.selectedRepoId) void memoryState.loadMemories(repo.selectedRepoId); }, [repo.selectedRepoId, memoryState.loadMemories]);
  useEffect(() => { if (repo.selectedRepoId) void glossaryState.loadTerms(repo.selectedRepoId); }, [repo.selectedRepoId, glossaryState.loadTerms]);

  // ── Tasklist progress polling ──
  const [tasklistProgress, setTasklistProgress] = useState<Record<string, string>>({});
  useEffect(() => {
    const runId = run.activeRun?.id;
    const isRunning = run.activeRun?.status === "running";
    if (!runId || !isRunning) return;
    let cancelled = false;
    const poll = () => {
      if (cancelled) return;
      api<{ tasks: Record<string, string> }>(`/api/runs/${encodeURIComponent(runId)}/tasklist-progress`)
        .then((res) => { if (!cancelled) setTasklistProgress(res.tasks ?? {}); })
        .catch(() => {});
    };
    poll();
    const timer = setInterval(poll, 5000);
    return () => { cancelled = true; clearInterval(timer); };
  }, [run.activeRun?.id, run.activeRun?.status]);

  // Clear progress when task changes
  useEffect(() => { setTasklistProgress({}); }, [task.selectedTaskId]);

  // Load final progress when run finishes
  useEffect(() => {
    const runId = run.activeRun?.id;
    if (!runId || !run.runFinished) return;
    api<{ tasks: Record<string, string> }>(`/api/runs/${encodeURIComponent(runId)}/tasklist-progress`)
      .then((res) => setTasklistProgress(res.tasks ?? {}))
      .catch(() => {});
  }, [run.activeRun?.id, run.runFinished]);

  // ── Details panel effects ──
  useEffect(() => { if (!task.selectedTask) setDetailsOpen(false); }, [task.selectedTask]);

  const prevSelectedTaskIdRef = useRef("");
  useEffect(() => {
    if (task.selectedTaskId === prevSelectedTaskIdRef.current) return;
    prevSelectedTaskIdRef.current = task.selectedTaskId;
    if (!task.selectedTaskId) return;
    const t = task.tasks.find((t) => t.id === task.selectedTaskId);
    if (t?.status === "IN_REVIEW") setDetailsTab("review");
    else if (detailsTab === "review") setDetailsTab("run");
  }, [task.selectedTaskId, task.tasks, detailsTab]);

  useEffect(() => {
    if (!detailsOpen) return;
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape") setDetailsOpen(false); };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [detailsOpen]);

  const handlePinAsRule = async (commentId: string) => {
    try {
      await rulesState.pinCommentAsRule(commentId, repo.selectedRepoId || undefined);
      void rulesState.loadRules(repo.selectedRepoId || undefined);
    } catch { /* silent */ }
  };

  const totalProviderItemCount = Object.values(boot.providerItemCounts).reduce((a, b) => a + b, 0);

  // ── Render ──
  return (
    <div className={`min-h-screen bg-surface-0 text-text-primary transition-[padding] duration-200 ${detailsOpen ? "lg:pr-[540px]" : ""}`}>
      {/* Top Nav */}
      <nav className="sticky top-0 z-40 border-b border-border-default bg-surface-0/95 backdrop-blur-md">
        <div className="mx-auto flex h-14 max-w-7xl items-center justify-between px-5">
          <div className="flex items-center gap-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-dark border border-brand-glow">
              <span className="text-sm font-bold text-brand">B</span>
            </div>
            <div className="flex items-center gap-2">
              <h1 className="text-sm font-semibold text-text-primary">Branching Bad</h1>
              {repo.selectedRepo && (
                <>
                  <span className="text-text-muted">/</span>
                  <span className="text-sm text-text-secondary">{repo.selectedRepo.name}</span>
                </>
              )}
            </div>
            {/* Top-level tab switcher */}
            <div className="ml-2 flex items-center gap-0.5 rounded-lg border border-border-strong bg-surface-200 p-0.5">
              {(["board", "analyst", "workflow"] as const).map((tab) => {
                const labels: Record<typeof tab, string> = { board: "Board", analyst: "Task Analyst", workflow: "Workflow" };
                return (
                  <button
                    key={tab}
                    onClick={() => setTopTab(tab)}
                    className={`flex items-center gap-1.5 rounded-md px-3 py-1 text-xs font-medium transition ${
                      topTab === tab
                        ? "bg-surface-0 text-text-primary shadow-sm"
                        : "text-text-muted hover:text-text-secondary"
                    }`}
                  >
                    {tab === "analyst" && <IconAnalyst className="w-3 h-3 text-status-warning" />}
                    {labels[tab]}
                  </button>
                );
              })}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => void task.clearAllPipelines()} disabled={busy} className={`${btnSecondary} !px-3 !py-1.5 text-xs`} title="Clear all stuck pipelines">
              Clear Queue
            </button>
            <button
              onClick={() => setExtensionsOpen(true)}
              className="relative flex h-8 w-8 items-center justify-center rounded-md border border-border-strong bg-surface-300 text-text-muted transition hover:text-text-primary hover:border-border-strong"
              title="Extensions"
            >
              <IconExtensions />
              {totalProviderItemCount > 0 && (
                <span className="absolute -top-1.5 -right-1.5 inline-flex h-4 min-w-[16px] items-center justify-center rounded-full bg-status-danger px-1 text-[10px] font-bold text-white">
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

      {/* Alerts */}
      <div className="mx-auto max-w-7xl px-5">
        {error && !settingsOpen && (
          <div className="mt-4 rounded-lg border border-error-border bg-error-bg px-4 py-3 text-sm text-error-text">{error}</div>
        )}
        {info && !settingsOpen && (
          <div className="mt-4 rounded-lg border border-info-border bg-info-bg px-4 py-3 text-sm text-info-text">{info}</div>
        )}
      </div>

      {/* Main Content */}
      {topTab === 'board' && (
        <main className="mx-auto max-w-7xl px-5 py-6">
          <KanbanBoard
            groupedTasks={task.groupedTasks}
            selectedTaskId={task.selectedTaskId}
            onSelectTask={(taskId) => { task.setSelectedTaskId(taskId); setDetailsOpen(true); setDetailsTab("plan"); }}
            onCreateTask={() => setCreateTaskModalOpen(true)}
            selectedRepoId={repo.selectedRepoId}
            statusFromLane={task.statusFromLane}
            setTasks={task.setTasks}
            onError={setError}
            onConflict={(taskId, files) => {
              task.setSelectedTaskId(taskId);
              setDetailsOpen(true);
              setDetailsTab("review");
              review.setApplyConflicts(files);
              setError("Changes conflict with main. Resolve in the review panel.");
            }}
            agentProfiles={boot.agentProfiles}
            taskRunStates={run.taskRunStates}
            queueMode={repo.selectedRepo?.queue_mode}
            onToggleQueueMode={async () => {
              if (!repo.selectedRepo) return;
              const newMode = !repo.selectedRepo.queue_mode;
              try {
                await api(`/api/repos/${encodeURIComponent(repo.selectedRepo.id)}`, {
                  method: "PATCH",
                  body: JSON.stringify({ queueMode: newMode }),
                });
                void boot.bootstrap();
              } catch (err) {
                setError((err as Error).message);
              }
            }}
            toolbarContent={
              <JiraSprintQuickSwitch
                selectedRepoId={repo.selectedRepoId}
                busy={busy}
                onBusyChange={setBusy}
                onError={setError}
                onInfo={setInfo}
                onTasksRefresh={task.refreshTasks}
                refreshHint={`${info}|${error}|${extensionsOpen}`}
              />
            }
          />
        </main>
      )}

      {topTab === 'analyst' && (
        <main className="mx-auto flex max-w-7xl flex-col px-5 py-6" style={{ height: "calc(100vh - 56px)" }}>
          {repo.selectedRepoId ? (
            <div className="flex flex-1 overflow-hidden rounded-xl border border-border-default bg-surface-100">
              <TaskAnalystPanel
                repoId={repo.selectedRepoId}
                repos={boot.repos}
                agentProfiles={boot.agentProfiles}
                onCreateTask={(prefill) => {
                  setTaskPrefill(prefill);
                  setCreateTaskModalOpen(true);
                }}
                analystState={analyst}
                autoFocus={true}
              />
            </div>
          ) : (
            <div className="flex h-full items-center justify-center text-sm text-text-muted">
              Select a repository to use the Task Analyst.
            </div>
          )}
        </main>
      )}

      {topTab === 'workflow' && (
        <main className="mx-auto flex max-w-7xl flex-col px-5 py-6" style={{ height: "calc(100vh - 56px)" }}>
          <WorkflowTab
            repoId={repo.selectedRepoId}
            agentProfiles={boot.agentProfiles.map((p) => ({ id: p.id, name: p.agent_name }))}
          />
        </main>
      )}

      {detailsOpen && task.selectedTask && (
        <DetailsSidebar
          selectedTask={task.selectedTask}
          plans={plan.plans} selectedPlanId={plan.selectedPlanId} setSelectedPlanId={plan.setSelectedPlanId}
          latestPlan={plan.latestPlan} approvedPlan={plan.approvedPlan}
          activePlanJob={plan.activePlanJob} planLogs={plan.planLogs} planFinished={plan.planFinished}
          activeRun={run.activeRun} runLogs={run.runLogs} runFinished={run.runFinished} runResult={run.runResult}
          selectedProfile={repo.selectedProfile}
          taskRequiresPlan={task.selectedTask.require_plan}
          selectedProfileId={repo.selectedProfileId}
          detailsTab={detailsTab} setDetailsTab={setDetailsTab}
          planComment={plan.planComment} setPlanComment={plan.setPlanComment} planActionInProgress={plan.planActionInProgress}
          manualPlanMarkdown={plan.manualPlanMarkdown} setManualPlanMarkdown={plan.setManualPlanMarkdown}
          manualTasklistJsonText={plan.manualTasklistJsonText} setManualTasklistJsonText={plan.setManualTasklistJsonText}
          tasklistValidationError={plan.tasklistValidationError}
          reviewComments={review.reviewComments} reviewText={review.reviewText} setReviewText={review.setReviewText}
          runDiff={review.runDiff} runDiffLoading={review.runDiffLoading}
          reviewMode={review.reviewMode} setReviewMode={review.setReviewMode}
          batchLineComments={review.batchLineComments} setBatchLineComments={review.setBatchLineComments}
          lineSelection={review.lineSelection} draftText={review.draftText} setDraftText={review.setDraftText}
          applyConflicts={review.applyConflicts}
          gitStatus={review.gitStatus}
          busy={busy}
          onClose={() => setDetailsOpen(false)}
          onEditTask={() => setEditTaskModalOpen(true)}
          onDeleteTask={() => void task.deleteTask(task.selectedTask!)}
          onCreatePlan={() => void plan.createPlan()}
          onPlanAction={(action) => void plan.planAction(action)}
          onValidateTasklist={plan.onValidateTasklist}
          onSaveManualRevision={() => void plan.saveManualRevision()}
          onStartRun={() => void run.startRun()}
          onResumeRun={() => void run.resumeRun()}
          onStopRun={() => void run.stopRun()}
          onSubmitReview={() => void review.submitReview()}
          onSubmitBatchReview={() => void review.submitBatchReview()}
          onApplyToMain={(opts) => void review.applyToMain(opts)}
          onPushBranch={() => void review.pushBranch()}
          onCreatePR={() => void review.createPR()}
          onMarkTaskDone={() => void review.markTaskDone()}
          onArchiveTask={() => void task.archiveTask()}
          onLineSelect={review.handleLineSelect}
          onLineSave={review.handleLineSave}
          onLineCancel={review.handleLineCancel}
          chatMessages={chat.chatMessages} chatQueuedCount={chat.chatQueuedCount}
          onSendChat={chat.sendChatMessage} onCancelQueuedChat={chat.cancelQueuedChat}
          onRequeueAutostart={() => void task.requeueAutostart()}
          onClearTaskPipeline={() => void task.clearTaskPipeline()}
          onExpandReview={() => setReviewModalOpen(true)}
          onExpandPlan={() => setPlanModalOpen(true)}
          customBranchName={run.customBranchName}
          setCustomBranchName={run.setCustomBranchName}
          agentProfiles={boot.agentProfiles}
          reviewProfileId={review.reviewProfileId}
          onReviewProfileChange={review.setReviewProfileId}
          carryDirtyState={review.carryDirtyState}
          onCarryDirtyStateChange={review.setCarryDirtyState}
          onPinAsRule={(commentId) => void handlePinAsRule(commentId)}
          onEditReviewComment={(id, text) => void review.editReviewComment(id, text)}
          onDeleteReviewComment={(id) => void review.deleteReviewComment(id)}
          onResendReviewComment={(id) => void review.resendReviewComment(id)}
          onResolveConflicts={(mode, files) => void review.resolveConflicts(mode, files)}
          chatProfileId={chat.chatProfileId}
          onChatProfileChange={chat.setChatProfileId}
          aiFeedback={plan.aiFeedback}
          setAiFeedback={plan.setAiFeedback}
          aiFeedbackParsed={plan.aiFeedbackParsed}
          aiFeedbackLoading={plan.aiFeedbackLoading}
          aiFeedbackStreamText={plan.aiFeedbackStreamText}
          aiFeedbackOpen={plan.aiFeedbackOpen}
          setAiFeedbackOpen={plan.setAiFeedbackOpen}
          reviewPlanProfileId={plan.reviewPlanProfileId}
          onReviewPlanProfileChange={plan.setReviewPlanProfileId}
          selectedFeedbackIndices={plan.selectedFeedbackIndices}
          onToggleFeedbackIndex={plan.toggleFeedbackIndex}
          onReviewPlan={() => void plan.reviewPlan(plan.reviewPlanProfileId)}
          onUseAiFeedbackAsRevision={plan.useAiFeedbackAsRevision}
          tasklistProgress={tasklistProgress}
        />
      )}

      {task.selectedTask && reviewModalOpen && (
        <DiffReviewModal
          open={reviewModalOpen}
          onClose={() => setReviewModalOpen(false)}
          selectedTask={task.selectedTask}
          reviewComments={review.reviewComments}
          reviewText={review.reviewText}
          setReviewText={review.setReviewText}
          runDiff={review.runDiff}
          runDiffLoading={review.runDiffLoading}
          reviewMode={review.reviewMode}
          setReviewMode={review.setReviewMode}
          batchLineComments={review.batchLineComments}
          setBatchLineComments={review.setBatchLineComments}
          lineSelection={review.lineSelection}
          draftText={review.draftText}
          setDraftText={review.setDraftText}
          applyConflicts={review.applyConflicts}
          gitStatus={review.gitStatus}
          busy={busy}
          onSubmitReview={() => void review.submitReview()}
          onSubmitBatchReview={() => void review.submitBatchReview()}
          onApplyToMain={(opts) => void review.applyToMain(opts)}
          onPushBranch={() => void review.pushBranch()}
          onCreatePR={() => void review.createPR()}
          onMarkTaskDone={() => void review.markTaskDone()}
          onArchiveTask={() => void task.archiveTask()}
          onLineSelect={review.handleLineSelect}
          onLineSave={review.handleLineSave}
          onLineCancel={review.handleLineCancel}
          agentProfiles={boot.agentProfiles}
          reviewProfileId={review.reviewProfileId}
          onReviewProfileChange={review.setReviewProfileId}
          carryDirtyState={review.carryDirtyState}
          onCarryDirtyStateChange={review.setCarryDirtyState}
          onPinAsRule={(commentId) => void handlePinAsRule(commentId)}
          onEditReviewComment={(id, text) => void review.editReviewComment(id, text)}
          onDeleteReviewComment={(id) => void review.deleteReviewComment(id)}
          onResendReviewComment={(id) => void review.resendReviewComment(id)}
          onResolveConflicts={(mode, files) => void review.resolveConflicts(mode, files)}
        />
      )}

      {task.selectedTask && planModalOpen && (
        <PlanExpandModal
          open={planModalOpen}
          onClose={() => setPlanModalOpen(false)}
          selectedTask={task.selectedTask}
          plans={plan.plans} selectedPlanId={plan.selectedPlanId} setSelectedPlanId={plan.setSelectedPlanId}
          latestPlan={plan.latestPlan}
          activePlanJob={plan.activePlanJob} planLogs={plan.planLogs} planFinished={plan.planFinished}
          taskRequiresPlan={task.selectedTask.require_plan}
          planComment={plan.planComment} setPlanComment={plan.setPlanComment}
          manualPlanMarkdown={plan.manualPlanMarkdown} setManualPlanMarkdown={plan.setManualPlanMarkdown}
          manualTasklistJsonText={plan.manualTasklistJsonText} setManualTasklistJsonText={plan.setManualTasklistJsonText}
          tasklistValidationError={plan.tasklistValidationError}
          busy={busy}
          onCreatePlan={() => void plan.createPlan()}
          onPlanAction={(action) => void plan.planAction(action)}
          onValidateTasklist={plan.onValidateTasklist}
          onSaveManualRevision={() => void plan.saveManualRevision()}
          agentProfiles={boot.agentProfiles}
          aiFeedback={plan.aiFeedback}
          setAiFeedback={plan.setAiFeedback}
          aiFeedbackParsed={plan.aiFeedbackParsed}
          aiFeedbackLoading={plan.aiFeedbackLoading}
          aiFeedbackStreamText={plan.aiFeedbackStreamText}
          aiFeedbackOpen={plan.aiFeedbackOpen}
          setAiFeedbackOpen={plan.setAiFeedbackOpen}
          reviewPlanProfileId={plan.reviewPlanProfileId}
          onReviewPlanProfileChange={plan.setReviewPlanProfileId}
          selectedFeedbackIndices={plan.selectedFeedbackIndices}
          onToggleFeedbackIndex={plan.toggleFeedbackIndex}
          onReviewPlan={() => void plan.reviewPlan(plan.reviewPlanProfileId)}
          onUseAiFeedbackAsRevision={plan.useAiFeedbackAsRevision}
          planActionInProgress={plan.planActionInProgress}
        />
      )}

      <ExtensionsDrawer
        open={extensionsOpen}
        onClose={() => setExtensionsOpen(false)}
        selectedRepoId={repo.selectedRepoId}
        providerMetas={boot.providerMetas}
        providerItemCounts={boot.providerItemCounts}
        busy={busy}
        error={error}
        info={info}
        onBusyChange={setBusy}
        onTasksRefresh={task.refreshTasks}
        onError={setError}
        onInfo={setInfo}
        onBootstrapRefresh={boot.bootstrap}
      />

      <SettingsModal
        open={settingsOpen} onClose={() => setSettingsOpen(false)}
        repos={boot.repos} agentProfiles={boot.agentProfiles}
        selectedRepoId={repo.selectedRepoId} setSelectedRepoId={repo.setSelectedRepoId}
        selectedProfileId={repo.selectedProfileId} setSelectedProfileId={repo.setSelectedProfileId}
        selectedProfile={repo.selectedProfile}
        busy={busy} error={error} info={info}
        onRepoSubmit={repo.onRepoSubmit}
        discoverAgents={repo.discoverAgents} saveAgentSelection={repo.saveAgentSelection}
        repoPath={repo.repoPath} setRepoPath={repo.setRepoPath}
        repoName={repo.repoName} setRepoName={repo.setRepoName}
        onReposChange={boot.bootstrap}
        globalRules={rulesState.globalRules}
        repoRules={rulesState.repoRules}
        onAddRule={rulesState.addRule}
        onUpdateRule={rulesState.updateRule}
        onDeleteRule={rulesState.deleteRule}
        onOptimizeRules={rulesState.optimizeRules}
        onBulkReplaceRules={rulesState.bulkReplaceRules}
        onRulesRefresh={() => void rulesState.loadRules(repo.selectedRepoId || undefined)}
        memories={memoryState.memories}
        memoryTotal={memoryState.total}
        memoryPage={memoryState.page}
        memoryTotalPages={memoryState.totalPages}
        memoryLoading={memoryState.loading}
        memorySearchQuery={memoryState.searchQuery}
        onMemorySearchChange={memoryState.setSearchQuery}
        onLoadMemories={memoryState.loadMemories}
        onDeleteMemory={memoryState.deleteMemory}
        glossaryTerms={glossaryState.terms}
        glossaryLoading={glossaryState.loading}
        onAddGlossaryTerm={glossaryState.addTerm}
        onUpdateGlossaryTerm={glossaryState.updateTerm}
        onDeleteGlossaryTerm={glossaryState.deleteTerm}
        onExportGlossary={glossaryState.exportTerms}
        onImportGlossary={glossaryState.importTerms}
        onExportMemories={memoryState.exportMemories}
        onImportMemories={memoryState.importMemories}
        onClearOutputs={async () => {
          await api("/api/outputs", { method: "DELETE" });
          setInfo("All output logs cleared.");
        }}
      />

      {repo.selectedRepoId && (
        <TaskAnalystModal
          open={analystOpen}
          onClose={() => setAnalystOpen(false)}
          repoId={repo.selectedRepoId}
          repos={boot.repos}
          agentProfiles={boot.agentProfiles}
          onCreateTask={(prefill) => {
            setTaskPrefill(prefill);
            setCreateTaskModalOpen(true);
          }}
          analystState={analyst}
        />
      )}

      <CreateTaskModal
        open={createTaskModalOpen} onClose={() => { setCreateTaskModalOpen(false); setTaskPrefill(null); }} busy={busy}
        agentProfiles={boot.agentProfiles}
        onSubmit={task.createManualTask} repoName={repo.selectedRepo?.name ?? "selected repo"}
        prefill={taskPrefill}
        repoId={repo.selectedRepoId || undefined}
      />

      <EditTaskModal
        open={editTaskModalOpen} onClose={() => setEditTaskModalOpen(false)} busy={busy}
        task={task.selectedTask}
        agentProfiles={boot.agentProfiles}
        onSave={task.saveTaskEdits}
      />

      <StatusBar
        runs={visibleRuns}
        exitingRunIds={exitingRunIds}
        onCancel={cancelRun}
        onResume={resumeRun}
        onNavigate={handleRunNavigate}
      />
      <ThanosSnapFilter />
      <ToastNotification
        toasts={toasts}
        onDismiss={dismissToast}
        onNavigate={handleRunNavigate}
      />
    </div>
  );
}
