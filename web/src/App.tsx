import { useEffect, useState, useRef } from "react";
import { api } from "./api";
import { btnSecondary } from "./components/shared";
import { IconSettings, IconExtensions } from "./components/icons";
import { SettingsModal } from "./components/SettingsModal";
import { ExtensionsDrawer } from "./components/ExtensionsDrawer";
import { CreateTaskModal } from "./components/CreateTaskModal";
import { EditTaskModal } from "./components/EditTaskModal";
import { KanbanBoard } from "./components/KanbanBoard";
import { DetailsSidebar } from "./components/DetailsSidebar";
import { DiffReviewModal } from "./components/DiffReviewModal";
import { PlanExpandModal } from "./components/PlanExpandModal";
import { initProviders } from "./providers/init";
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

  // ── Stream function ref (breaks circular dep between hooks and useEventStream) ──
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
    streamRef, detailsOpen, setError, setInfo, setBusy, setTasks: task.setTasks,
  });
  const run = useRunState({
    selectedTaskId: task.selectedTaskId, selectedRepoId: repo.selectedRepoId,
    selectedProfileId: repo.selectedProfileId, selectedTask: task.selectedTask,
    approvedPlan: plan.approvedPlan, streamRef,
    setTasks: task.setTasks, setError, setInfo, setBusy,
  });
  const review = useReviewState({
    selectedTaskId: task.selectedTaskId, selectedRepoId: repo.selectedRepoId,
    tasks: task.tasks, taskRunStates: run.taskRunStates, detailsTab,
    streamRef, updateTaskRunState: run.updateTaskRunState,
    setTasks: task.setTasks, setError, setInfo, setBusy, setDetailsTab,
  });
  const rulesState = useRulesState();
  const memoryState = useMemoryState();
  const chat = useChatState({
    selectedTaskId: task.selectedTaskId, selectedRepoId: repo.selectedRepoId,
    streamRef, updateTaskRunState: run.updateTaskRunState, setError,
  });

  // ── Event Stream (bridges all domain hooks via WebSocket) ──
  const stream = useEventStream({
    updateTaskRunState: run.updateTaskRunState,
    updateTaskPlanState: plan.updateTaskPlanState,
    setTasks: task.setTasks,
    setPlans: plan.setPlans,
    setReviewComments: review.setReviewComments,
    setChatMessages: chat.setChatMessages,
    setInfo,
    selectedTaskIdRef: task.selectedTaskIdRef,
  });
  streamRef.current = stream;

  // ── Auto-select first repo on bootstrap ──
  useEffect(() => { repo.initRepoId(boot.repos); }, [boot.repos, repo.initRepoId]);

  // ── Load rules when repo changes ──
  useEffect(() => { void rulesState.loadRules(repo.selectedRepoId || undefined); }, [repo.selectedRepoId, rulesState.loadRules]);

  // ── Load memories when repo changes ──
  useEffect(() => { if (repo.selectedRepoId) void memoryState.loadMemories(repo.selectedRepoId); }, [repo.selectedRepoId, memoryState.loadMemories]);

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
          agentProfiles={boot.agentProfiles}
          taskRunStates={run.taskRunStates}
        />
      </main>

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
          onStopRun={() => void run.stopRun()}
          onSubmitReview={() => void review.submitReview()}
          onSubmitBatchReview={() => void review.submitBatchReview()}
          onApplyToMain={(opts) => void review.applyToMain(opts)}
          onPushBranch={() => void review.pushBranch()}
          onCreatePR={() => void review.createPR()}
          onMarkTaskDone={() => void review.markTaskDone()}
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
          onPinAsRule={(commentId) => void handlePinAsRule(commentId)}
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
          onLineSelect={review.handleLineSelect}
          onLineSave={review.handleLineSave}
          onLineCancel={review.handleLineCancel}
          agentProfiles={boot.agentProfiles}
          reviewProfileId={review.reviewProfileId}
          onReviewProfileChange={review.setReviewProfileId}
          onPinAsRule={(commentId) => void handlePinAsRule(commentId)}
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
        onClearOutputs={async () => {
          await api("/api/outputs", { method: "DELETE" });
          setInfo("All output logs cleared.");
        }}
      />

      <CreateTaskModal
        open={createTaskModalOpen} onClose={() => setCreateTaskModalOpen(false)} busy={busy}
        agentProfiles={boot.agentProfiles}
        onSubmit={task.createManualTask} repoName={repo.selectedRepo?.name ?? "selected repo"}
      />

      <EditTaskModal
        open={editTaskModalOpen} onClose={() => setEditTaskModalOpen(false)} busy={busy}
        task={task.selectedTask}
        agentProfiles={boot.agentProfiles}
        onSave={task.saveTaskEdits}
      />
    </div>
  );
}
