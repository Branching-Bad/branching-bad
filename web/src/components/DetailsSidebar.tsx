import type { Task, Plan, PlanJob, AgentProfile, RunLogEntry, RunResponse, ReviewComment, LineComment, ActiveRun, ChatMessage, ApplyToMainOptions, GitStatusInfo } from "../types";
import { IconX, IconPlay, IconRocket, IconGitBranch, IconFastForward, IconDocument, IconBolt, IconArrowUp, IconArrowDown, IconExpand } from "./icons";
import { LogViewer } from "./LogViewer";
import { ChatPanel } from "./ChatPanel";
import { formatDate, laneFromStatus, inputClass, selectClass, btnPrimary, btnSecondary, planStatusColor, runStatusColor } from "./shared";
import { DiffReviewPanel } from "./DiffReviewPanel";
import { AgentProfileSelect } from "./AgentProfileSelect";

export function DetailsSidebar({
  selectedTask,
  plans, selectedPlanId, setSelectedPlanId,
  latestPlan, approvedPlan,
  activePlanJob, planLogs, planFinished,
  activeRun, runLogs, runFinished, runResult,
  selectedProfile,
  taskRequiresPlan,
  selectedProfileId,
  detailsTab, setDetailsTab,
  planComment, setPlanComment, planActionInProgress,
  manualPlanMarkdown, setManualPlanMarkdown,
  manualTasklistJsonText, setManualTasklistJsonText,
  tasklistValidationError,
  reviewComments, reviewText, setReviewText,
  runDiff, runDiffLoading,
  reviewMode, setReviewMode,
  batchLineComments, setBatchLineComments,
  lineSelection, draftText, setDraftText,
  applyConflicts,
  gitStatus,
  busy,
  onClose,
  onEditTask, onDeleteTask,
  onCreatePlan, onPlanAction, onValidateTasklist, onSaveManualRevision,
  onStartRun, onResumeRun, onStopRun,
  onSubmitReview, onSubmitBatchReview, onApplyToMain, onPushBranch, onCreatePR, onMarkTaskDone, onArchiveTask,
  onLineSelect, onLineSave, onLineCancel,
  onRequeueAutostart, onClearTaskPipeline,
  chatMessages, chatQueuedCount,
  onSendChat, onCancelQueuedChat,
  onExpandReview,
  onExpandPlan,
  customBranchName, setCustomBranchName,
  agentProfiles,
  reviewProfileId, onReviewProfileChange,
  carryDirtyState, onCarryDirtyStateChange,
  onPinAsRule,
  onEditReviewComment, onDeleteReviewComment, onResendReviewComment,
  onResolveConflicts,
  chatProfileId, onChatProfileChange,
  aiFeedback, setAiFeedback, aiFeedbackParsed,
  aiFeedbackLoading, aiFeedbackStreamText, aiFeedbackOpen, setAiFeedbackOpen,
  reviewPlanProfileId, onReviewPlanProfileChange,
  selectedFeedbackIndices, onToggleFeedbackIndex,
  onReviewPlan, onUseAiFeedbackAsRevision,
  tasklistProgress,
}: {
  selectedTask: Task;
  plans: Plan[]; selectedPlanId: string; setSelectedPlanId: (v: string) => void;
  latestPlan: Plan | null; approvedPlan: Plan | null;
  activePlanJob: PlanJob | null; planLogs: RunLogEntry[]; planFinished: boolean;
  activeRun: ActiveRun | null; runLogs: RunLogEntry[]; runFinished: boolean; runResult: RunResponse | null;
  selectedProfile: AgentProfile | null;
  taskRequiresPlan: boolean;
  selectedProfileId: string;
  detailsTab: "plan" | "tasklist" | "run" | "review";
  setDetailsTab: (v: "plan" | "tasklist" | "run" | "review") => void;
  planComment: string; setPlanComment: (v: string) => void; planActionInProgress?: string;
  manualPlanMarkdown: string; setManualPlanMarkdown: (v: string) => void;
  manualTasklistJsonText: string; setManualTasklistJsonText: (v: string) => void;
  tasklistValidationError: string;
  reviewComments: ReviewComment[]; reviewText: string; setReviewText: (v: string) => void;
  runDiff: string; runDiffLoading: boolean;
  reviewMode: "instant" | "batch"; setReviewMode: (v: "instant" | "batch") => void;
  batchLineComments: LineComment[]; setBatchLineComments: (v: LineComment[]) => void;
  lineSelection: { filePath: string; lineStart: number; lineEnd: number; hunk: string; anchorKey: string } | null;
  draftText: string; setDraftText: (v: string) => void;
  applyConflicts: string[];
  gitStatus?: GitStatusInfo | null;
  busy: boolean;
  onClose: () => void;
  onEditTask: () => void;
  onDeleteTask: () => void;
  onCreatePlan: () => void;
  onPlanAction: (action: "approve" | "reject" | "revise") => void;
  onValidateTasklist: () => void;
  onSaveManualRevision: () => void;
  onStartRun: () => void;
  onResumeRun: () => void;
  onStopRun: () => void;
  onSubmitReview: () => void;
  onSubmitBatchReview: () => void;
  onApplyToMain: (opts?: ApplyToMainOptions) => void;
  onPushBranch?: () => void;
  onCreatePR?: () => void;
  onMarkTaskDone: () => void;
  onArchiveTask?: () => void;
  onLineSelect: (filePath: string, lineStart: number, lineEnd: number, hunk: string, anchorKey: string) => void;
  onLineSave: () => void;
  onLineCancel: () => void;
  chatMessages: ChatMessage[]; chatQueuedCount: number;
  onSendChat: (content: string) => Promise<void>;
  onCancelQueuedChat: () => Promise<void>;
  onRequeueAutostart: () => void;
  onClearTaskPipeline: () => void;
  onExpandReview?: () => void;
  onExpandPlan?: () => void;
  customBranchName: string;
  setCustomBranchName: (v: string) => void;
  agentProfiles?: AgentProfile[];
  reviewProfileId?: string;
  onReviewProfileChange?: (v: string) => void;
  carryDirtyState?: boolean;
  onCarryDirtyStateChange?: (v: boolean) => void;
  onPinAsRule?: (commentId: string) => void;
  onEditReviewComment?: (commentId: string, newText: string) => void;
  onDeleteReviewComment?: (commentId: string) => void;
  onResendReviewComment?: (commentId: string) => void;
  onResolveConflicts?: (mode: 'agent' | 'manual', files: string[]) => void;
  chatProfileId?: string;
  onChatProfileChange?: (v: string) => void;
  aiFeedback?: string;
  setAiFeedback?: (v: string) => void;
  aiFeedbackParsed?: { verdict: string; comments: Array<{ category: string; severity: string; reason: string; suggestion: string }> } | null;
  aiFeedbackLoading?: boolean;
  aiFeedbackStreamText?: string;
  aiFeedbackOpen?: boolean;
  setAiFeedbackOpen?: (v: boolean) => void;
  reviewPlanProfileId?: string;
  onReviewPlanProfileChange?: (v: string) => void;
  selectedFeedbackIndices?: Set<number>;
  onToggleFeedbackIndex?: (index: number) => void;
  onReviewPlan?: () => void;
  onUseAiFeedbackAsRevision?: () => void;
  tasklistProgress?: Record<string, string>;
}) {
  const selectedPlan = plans.find((p) => p.id === selectedPlanId) ?? latestPlan;
  tasklistProgress = tasklistProgress ?? {};

  return (
    <>
      <button
        type="button"
        aria-label="Close details"
        onClick={onClose}
        className="fixed inset-0 z-[41] bg-black/50 backdrop-blur-[1px] lg:hidden"
      />

      <aside className="fixed inset-y-0 right-0 z-[42] w-full max-w-[540px] border-l border-border-default bg-surface-100 shadow-2xl">
        <div className="flex h-full flex-col">
          <div className="border-b border-border-default px-5 py-4">
            <div className="mb-3 flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-xs font-medium text-brand">{selectedTask.jira_issue_key}</p>
                <h3 className="mt-1 line-clamp-2 text-sm font-semibold text-text-primary">{selectedTask.title}</h3>
              </div>
              <div className="flex items-center gap-1.5">
                <button
                  onClick={onEditTask}
                  className="rounded-md border border-border-strong bg-surface-300 px-2 py-1 text-[11px] font-medium text-text-secondary transition hover:text-text-primary"
                >
                  Edit
                </button>
                {laneFromStatus(selectedTask.status) === "todo" && (
                  <button
                    onClick={onDeleteTask}
                    className="rounded-md border border-status-danger/40 bg-status-danger/10 px-2 py-1 text-[11px] font-medium text-status-danger transition hover:bg-status-danger/20 hover:text-status-danger"
                  >
                    Delete
                  </button>
                )}
                <button
                  onClick={onClose}
                  className="rounded-md p-1 text-text-muted transition hover:bg-surface-300 hover:text-text-primary"
                >
                  <IconX className="h-4 w-4" />
                </button>
              </div>
            </div>
            <div className="flex items-center gap-1.5 text-[11px]">
              <span className="rounded-full border border-border-strong bg-surface-300 px-2 py-0.5 text-text-secondary">
                {selectedTask.status}
              </span>
              {selectedTask.priority && (
                <span
                  title={`Priority: ${selectedTask.priority}`}
                  className={`inline-flex items-center rounded-full border p-1 ${
                    selectedTask.priority === "highest" || selectedTask.priority === "high"
                      ? "border-status-danger/40 bg-status-danger/10 text-status-danger"
                      : selectedTask.priority === "medium"
                        ? "border-status-warning/40 bg-status-warning/10 text-status-warning"
                        : "border-brand/40 bg-brand/10 text-brand"
                  }`}
                >
                  {selectedTask.priority === "highest" || selectedTask.priority === "high"
                    ? <IconArrowUp className="h-3 w-3" />
                    : selectedTask.priority === "low" || selectedTask.priority === "lowest"
                      ? <IconArrowDown className="h-3 w-3" />
                      : <span className="h-3 w-3 flex items-center justify-center text-[9px] font-bold">=</span>
                  }
                </span>
              )}
              <span
                title={selectedTask.require_plan ? "Require Plan" : "Direct Run"}
                className={`inline-flex items-center rounded-full border p-1 ${
                  selectedTask.require_plan
                    ? "border-status-warning/40 bg-status-warning/10 text-status-warning"
                    : "border-border-strong bg-surface-300 text-text-muted"
                }`}
              >
                {selectedTask.require_plan
                  ? <IconDocument className="h-3 w-3" />
                  : <IconBolt className="h-3 w-3" />
                }
              </span>
              <span
                title={selectedTask.auto_approve_plan ? "Auto Approve: On" : "Auto Approve: Off"}
                className={`inline-flex items-center rounded-full border p-1 ${
                  selectedTask.auto_approve_plan
                    ? "border-status-warning/40 bg-status-warning/10 text-status-warning"
                    : "border-border-strong bg-surface-300 text-text-muted"
                }`}
              >
                <IconRocket className="h-3 w-3" />
              </span>
              <span
                title={selectedTask.auto_start ? "Autostart: On" : "Autostart: Off"}
                className={`inline-flex items-center rounded-full border p-1 ${
                  selectedTask.auto_start
                    ? "border-status-warning/40 bg-status-warning/10 text-status-warning"
                    : "border-border-strong bg-surface-300 text-text-muted"
                }`}
              >
                <IconFastForward className="h-3 w-3" />
              </span>
              <span
                title={selectedTask.use_worktree ? "Worktree" : "Direct"}
                className={`inline-flex items-center rounded-full border p-1 ${
                  selectedTask.use_worktree
                    ? "border-status-warning/40 bg-status-warning/10 text-status-warning"
                    : "border-border-strong bg-surface-300 text-text-muted"
                }`}
              >
                <IconGitBranch className="h-3 w-3" />
              </span>
              <span className="ml-1 text-text-muted">{formatDate(selectedTask.updated_at)}</span>
            </div>
            {selectedTask.description && (
              <p className="mt-3 line-clamp-3 text-xs leading-relaxed text-text-secondary">{selectedTask.description}</p>
            )}
            {selectedTask.last_pipeline_error && (
              <div className="mt-3 rounded-lg border border-error-border bg-error-bg px-3 py-2 text-[11px] text-error-text">
                <p className="font-medium">Pipeline Error</p>
                <p className="mt-1 whitespace-pre-wrap">{selectedTask.last_pipeline_error}</p>
                {selectedTask.last_pipeline_at && (
                  <p className="mt-1 text-[10px] opacity-70">{formatDate(selectedTask.last_pipeline_at)}</p>
                )}
                <div className="mt-2 flex gap-2">
                  {laneFromStatus(selectedTask.status) === "todo" && (
                    <button
                      onClick={onRequeueAutostart}
                      disabled={busy}
                      className="rounded-md border border-error-border bg-error-bg px-2.5 py-1 text-[11px] font-medium text-error-text transition hover:bg-surface-200 disabled:bg-surface-300/50 disabled:text-text-muted/40 disabled:cursor-not-allowed"
                    >
                      Requeue Pipeline
                    </button>
                  )}
                  <button
                    onClick={onClearTaskPipeline}
                    disabled={busy}
                    className="rounded-md border border-border-default bg-surface-secondary px-2.5 py-1 text-[11px] font-medium text-text-secondary transition hover:bg-surface-200 disabled:bg-surface-300/50 disabled:text-text-muted/40 disabled:cursor-not-allowed"
                    title="Clear stuck plan jobs and autostart jobs, reset task to TODO"
                  >
                    Clear Pipeline
                  </button>
                </div>
              </div>
            )}
            {!selectedTask.last_pipeline_error && ["PLAN_GENERATING", "PLAN_DRAFTED", "PLAN_APPROVED"].includes(selectedTask.status.trim().toUpperCase()) && (
              <div className="mt-3">
                <button
                  onClick={onClearTaskPipeline}
                  disabled={busy}
                  className="rounded-md border border-border-default bg-surface-secondary px-2.5 py-1 text-[11px] font-medium text-text-secondary transition hover:bg-surface-200 disabled:bg-surface-300/50 disabled:text-text-muted/40 disabled:cursor-not-allowed"
                  title="Clear stuck pipeline, reset task to TODO"
                >
                  Clear Pipeline
                </button>
              </div>
            )}
          </div>

          <div className="flex border-b border-border-default px-3">
            <div className="relative flex items-center">
              <button
                onClick={() => setDetailsTab("plan")}
                className={`relative px-3 py-2.5 text-sm font-medium transition ${
                  detailsTab === "plan" ? "text-brand" : "text-text-muted hover:text-text-secondary"
                }`}
              >
                Plan
                {detailsTab === "plan" && <span className="absolute bottom-0 left-0 right-0 h-[2px] bg-brand" />}
              </button>
              {detailsTab === "plan" && onExpandPlan && (
                <button onClick={onExpandPlan} title="Expand" className="rounded-md p-0.5 text-text-muted transition hover:bg-surface-300 hover:text-text-primary">
                  <IconExpand className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
            <div className="relative flex items-center">
              <button
                onClick={() => setDetailsTab("tasklist")}
                className={`relative px-3 py-2.5 text-sm font-medium transition ${
                  detailsTab === "tasklist" ? "text-brand" : "text-text-muted hover:text-text-secondary"
                }`}
              >
                Tasklist
                {detailsTab === "tasklist" && <span className="absolute bottom-0 left-0 right-0 h-[2px] bg-brand" />}
              </button>
              {detailsTab === "tasklist" && onExpandPlan && (
                <button onClick={onExpandPlan} title="Expand" className="rounded-md p-0.5 text-text-muted transition hover:bg-surface-300 hover:text-text-primary">
                  <IconExpand className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
            <button
              onClick={() => setDetailsTab("run")}
              className={`relative px-3 py-2.5 text-sm font-medium transition ${
                detailsTab === "run" ? "text-brand" : "text-text-muted hover:text-text-secondary"
              }`}
            >
              Run Output
              {detailsTab === "run" && <span className="absolute bottom-0 left-0 right-0 h-[2px] bg-brand" />}
            </button>
            {(selectedTask?.status === "IN_REVIEW" || selectedTask?.status === "DONE") && (
              <button
                onClick={() => setDetailsTab("review")}
                className={`relative px-3 py-2.5 text-sm font-medium transition ${
                  detailsTab === "review" ? "text-brand" : "text-text-muted hover:text-text-secondary"
                }`}
              >
                Review
                {reviewComments.length > 0 && (
                  <span className="ml-1.5 inline-flex h-4 min-w-[16px] items-center justify-center rounded-full bg-brand/20 px-1 text-[10px] font-semibold text-brand">
                    {reviewComments.length}
                  </span>
                )}
                {detailsTab === "review" && <span className="absolute bottom-0 left-0 right-0 h-[2px] bg-brand" />}
              </button>
            )}
          </div>

          <div className="flex-1 space-y-4 overflow-y-auto p-4">
            {detailsTab === "plan" && (
              <>
                <div className="rounded-xl border border-border-default bg-surface-200 p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="space-y-1">
                      <p className="text-xs font-medium text-text-secondary">Plan Status</p>
                      {latestPlan ? (
                        <div className="flex items-center gap-2">
                          <span className={`rounded-full border px-2 py-0.5 text-[11px] font-medium ${planStatusColor(latestPlan.status)}`}>
                            {latestPlan.status}
                          </span>
                          <span className="text-[11px] text-text-muted">v{latestPlan.version}</span>
                        </div>
                      ) : (
                        <span className="text-xs text-text-muted">No plan generated</span>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      {plans.length > 0 && (
                        <select
                          value={selectedPlanId}
                          onChange={(e) => setSelectedPlanId(e.target.value)}
                          className={`${selectClass} !w-[140px] !py-1.5 !text-xs`}
                        >
                          {plans.map((plan) => (
                            <option key={plan.id} value={plan.id}>
                              v{plan.version} · {plan.status}
                            </option>
                          ))}
                        </select>
                      )}
                      <button
                        onClick={onCreatePlan}
                        disabled={busy || activePlanJob?.status === "running" || activePlanJob?.status === "pending"}
                        className={`${btnPrimary} !px-3 !py-1.5 text-xs`}
                      >
                        {activePlanJob?.status === "running" || activePlanJob?.status === "pending"
                          ? "Planning..."
                          : (latestPlan ? "Regenerate" : "Generate Plan")}
                      </button>
                    </div>
                  </div>
                  {!taskRequiresPlan && (
                    <p className="mt-2 text-[11px] text-text-muted">
                      Plan is optional for this task. You can run directly from the Run tab.
                    </p>
                  )}
                  {activePlanJob && (
                    <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px]">
                      <span className={`rounded-full border px-2 py-0.5 font-medium ${
                        activePlanJob.status === "done"
                          ? "border-brand/40 bg-brand-tint text-brand"
                          : activePlanJob.status === "failed"
                            ? "border-error-border bg-error-bg text-error-text"
                            : "border-border-strong bg-surface-300 text-text-secondary"
                      }`}>
                        plan job: {activePlanJob.status}
                      </span>
                      <span className="text-text-muted">{activePlanJob.mode}</span>
                      <span className="text-text-muted">{formatDate(activePlanJob.updated_at)}</span>
                    </div>
                  )}
                </div>

                {/* Plan Draft */}
                <div className="rounded-xl border border-border-default bg-surface-200 p-3">
                  <div className="mb-2 flex items-center justify-between">
                    <h4 className="text-xs font-medium text-text-secondary">Plan Draft</h4>
                    {selectedPlan && (
                      <span className="text-[11px] text-text-muted">{formatDate(selectedPlan.created_at)}</span>
                    )}
                  </div>
                  {selectedPlan ? (
                    <textarea
                      value={manualPlanMarkdown}
                      onChange={(e) => setManualPlanMarkdown(e.target.value)}
                      className={`${inputClass} min-h-[220px] resize-y font-mono text-[12px] leading-relaxed`}
                      placeholder="Plan markdown..."
                    />
                  ) : (
                    <p className="rounded-lg border border-dashed border-border-strong px-3 py-6 text-center text-xs text-text-muted">
                      Select a task and generate a plan to see details.
                    </p>
                  )}
                </div>

                {/* AI Review trigger + Feedback */}
                {agentProfiles && agentProfiles.length > 0 && (
                  <div className="rounded-xl border border-border-default bg-surface-200 p-3">
                    <div className="flex items-center gap-2">
                      <AgentProfileSelect
                        profiles={agentProfiles}
                        value={reviewPlanProfileId ?? ""}
                        onChange={(v) => onReviewPlanProfileChange?.(v)}
                        className="flex-1 rounded-md border border-border-strong bg-surface-100 px-2 py-1.5 text-[11px] text-text-secondary focus:border-brand focus:outline-none"
                      />
                      <button
                        onClick={onReviewPlan}
                        disabled={busy || aiFeedbackLoading || !latestPlan || !reviewPlanProfileId}
                        className={`${btnSecondary} !px-3 !py-1.5 text-xs whitespace-nowrap`}
                      >
                        {aiFeedbackLoading ? "Reviewing..." : "Review Plan"}
                      </button>
                    </div>
                    {aiFeedbackLoading && (
                      <div className="mt-2 flex items-center gap-2 rounded-lg border border-brand/30 bg-brand/5 px-2.5 py-2">
                        <span className="inline-block h-3.5 w-3.5 shrink-0 animate-spin rounded-full border-2 border-brand border-t-transparent" />
                        <span className="min-w-0 truncate text-[11px] text-brand">
                          {aiFeedbackStreamText
                            ? (aiFeedbackStreamText.length > 50 ? aiFeedbackStreamText.slice(-50) : aiFeedbackStreamText)
                            : "Starting AI review…"}
                        </span>
                      </div>
                    )}
                  </div>
                )}

                {(aiFeedback || aiFeedbackOpen) && (
                  <div className={`rounded-xl border p-3 ${
                    aiFeedbackParsed?.verdict === "passed"
                      ? "border-status-success/30 bg-status-success/10"
                      : aiFeedbackParsed?.verdict === "failed"
                        ? "border-status-danger/30 bg-status-danger/10"
                        : "border-status-pending/30 bg-status-pending/10"
                  }`}>
                    <div className="mb-2 flex items-center justify-between">
                      <button
                        onClick={() => setAiFeedbackOpen?.(!aiFeedbackOpen)}
                        className="flex items-center gap-1.5 text-xs font-medium text-text-secondary hover:text-text-primary transition"
                      >
                        <span className={`inline-block text-[10px] transition-transform ${aiFeedbackOpen ? "rotate-90" : ""}`}>&#9654;</span>
                        AI Review
                        {aiFeedbackParsed && (
                          <span className={`ml-1.5 rounded-full border px-2 py-0.5 text-[10px] font-semibold ${
                            aiFeedbackParsed.verdict === "passed"
                              ? "border-status-success/40 bg-status-success/15 text-status-success"
                              : "border-status-danger/40 bg-status-danger/15 text-status-danger"
                          }`}>
                            {aiFeedbackParsed.verdict.toUpperCase()}
                          </span>
                        )}
                      </button>
                      {aiFeedbackOpen && aiFeedbackParsed?.verdict === "failed" && aiFeedbackParsed.comments.length > 0 && (
                        <button
                          onClick={onUseAiFeedbackAsRevision}
                          className="rounded-md border border-status-pending/30 bg-status-pending/10 px-2.5 py-1 text-[11px] font-medium text-status-pending transition hover:bg-status-pending/20"
                        >
                          {selectedFeedbackIndices && selectedFeedbackIndices.size > 0
                            ? `Revise with ${selectedFeedbackIndices.size} selected`
                            : "Use All as Revision"}
                        </button>
                      )}
                    </div>
                    {aiFeedbackOpen && (
                      aiFeedbackParsed ? (
                        aiFeedbackParsed.verdict === "passed" ? (
                          <p className="text-xs text-status-success">Plan looks good. No issues found.</p>
                        ) : (
                          <div className="space-y-2">
                            {aiFeedbackParsed.comments.map((c, i) => (
                              <div
                                key={i}
                                onClick={() => onToggleFeedbackIndex?.(i)}
                                className={`cursor-pointer rounded-lg border px-3 py-2 transition ${
                                  selectedFeedbackIndices?.has(i)
                                    ? "border-status-pending/50 bg-status-pending/10"
                                    : "border-border-strong bg-surface-100 hover:border-border-default"
                                }`}
                              >
                                <div className="mb-1 flex items-center gap-2">
                                  <span className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border text-[10px] ${
                                    selectedFeedbackIndices?.has(i)
                                      ? "border-status-pending bg-status-pending text-white"
                                      : "border-border-strong bg-surface-100 text-transparent"
                                  }`}>✓</span>
                                  <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${
                                    c.severity === "critical" ? "bg-status-danger/15 text-status-danger"
                                    : c.severity === "major" ? "bg-status-warning/15 text-status-warning"
                                    : "bg-brand/15 text-brand"
                                  }`}>{c.severity}</span>
                                  <span className="rounded bg-surface-300 px-1.5 py-0.5 text-[10px] text-text-muted">{c.category}</span>
                                </div>
                                <p className="text-[11px] text-text-primary">{c.reason}</p>
                                <p className="mt-1 text-[11px] text-text-secondary">→ {c.suggestion}</p>
                              </div>
                            ))}
                          </div>
                        )
                      ) : (
                        <textarea
                          value={aiFeedback}
                          onChange={(e) => setAiFeedback?.(e.target.value)}
                          className={`${inputClass} min-h-[140px] resize-y font-mono text-[12px] leading-relaxed`}
                          placeholder="AI feedback will appear here..."
                        />
                      )
                    )}
                  </div>
                )}

                {/* Review Comment + Actions */}
                <div className="rounded-xl border border-border-default bg-surface-200 p-3">
                  <label className="mb-1.5 block text-xs font-medium text-text-muted">Review Comment</label>
                  <textarea
                    value={planComment}
                    onChange={(e) => setPlanComment(e.target.value)}
                    className={`${inputClass} min-h-[72px] resize-y`}
                    placeholder="Add approval/revision note..."
                  />
                  {planActionInProgress ? (
                    <div className="mt-3 flex items-center gap-2.5 rounded-lg border border-brand/30 bg-brand/5 px-3 py-2.5">
                      <span className="inline-block h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-brand border-t-transparent" />
                      <span className="text-xs font-medium text-brand">{planActionInProgress}</span>
                    </div>
                  ) : (
                    <div className="mt-3 flex flex-wrap gap-2">
                      <button
                        onClick={() => onPlanAction("approve")}
                        disabled={busy || !latestPlan}
                        className={`${btnPrimary} !px-3 !py-1.5 text-xs`}
                      >
                        Approve
                      </button>
                      <button
                        onClick={() => onPlanAction("revise")}
                        disabled={busy || !latestPlan}
                        className={`${btnSecondary} !px-3 !py-1.5 text-xs`}
                      >
                        Request Revision
                      </button>
                      <button
                        onClick={() => onPlanAction("reject")}
                        disabled={busy || !latestPlan}
                        className="rounded-md border border-error-border bg-error-bg px-3 py-1.5 text-xs font-medium text-error-text transition hover:bg-surface-200 disabled:bg-surface-300/50 disabled:text-text-muted/40 disabled:cursor-not-allowed"
                      >
                        Reject
                      </button>
                    </div>
                  )}
                </div>

                {/* Live Plan Output */}
                <div className="rounded-xl border border-border-default bg-surface-200 p-3">
                  <div className="mb-2 flex items-center justify-between">
                    <h4 className="text-xs font-medium text-text-secondary">Live Plan Output</h4>
                    {activePlanJob && (
                      <span className="text-[11px] text-text-muted">job {activePlanJob.id.slice(0, 8)}</span>
                    )}
                  </div>
                  <LogViewer
                    logs={planLogs}
                    className="h-[480px]"
                    emptyMessage={
                      activePlanJob
                        ? (planFinished ? "Plan output stream finished." : "Waiting for plan output...")
                        : "No active plan job."
                    }
                  />
                </div>
              </>
            )}

            {detailsTab === "tasklist" && (
              <>
                {/* Tasklist Summary with Progress */}
                {(() => {
                  try {
                    const tl = JSON.parse(manualTasklistJsonText);
                    const phases = tl?.phases as Array<{ id: string; name: string; tasks: Array<{ id: string; title: string; complexity?: string; suggested_model?: string }> }> | undefined;
                    if (!phases?.length) return null;
                    const items = phases.flatMap((p) => p.tasks ?? []);
                    const cxColors: Record<string, string> = { low: "bg-brand/15 text-brand", medium: "bg-status-warning/15 text-status-warning", high: "bg-status-danger/15 text-status-danger" };
                    const statusIcon: Record<string, { icon: string; color: string }> = {
                      completed: { icon: "\u2713", color: "text-brand bg-brand/15 border-brand/30" },
                      in_progress: { icon: "\u25B6", color: "text-status-caution bg-status-caution/15 border-status-caution/30 animate-pulse" },
                      pending: { icon: "\u2022", color: "text-text-muted bg-surface-300 border-border-default" },
                    };
                    const modelOptions = ["haiku", "sonnet", "opus"];
                    const updateTaskModel = (taskId: string, newModel: string) => {
                      try {
                        const parsed = JSON.parse(manualTasklistJsonText);
                        for (const phase of parsed.phases ?? []) {
                          for (const task of phase.tasks ?? []) {
                            if (task.id === taskId) {
                              task.suggested_model = newModel || undefined;
                            }
                          }
                        }
                        setManualTasklistJsonText(JSON.stringify(parsed, null, 2));
                      } catch { /* ignore parse errors */ }
                    };
                    const completedCount = items.filter((t) => tasklistProgress[t.id] === "completed").length;
                    const hasProgress = Object.keys(tasklistProgress).length > 0;
                    return (
                      <div className="rounded-xl border border-border-default bg-surface-200 p-3">
                        <div className="mb-2 flex items-center justify-between">
                          <h4 className="text-xs font-medium text-text-secondary">Tasklist Overview</h4>
                          {hasProgress && (
                            <span className="text-[11px] tabular-nums text-text-muted">
                              {completedCount}/{items.length} done
                            </span>
                          )}
                        </div>
                        {/* Progress bar */}
                        {hasProgress && items.length > 0 && (
                          <div className="mb-2.5 h-1.5 w-full overflow-hidden rounded-full bg-surface-300">
                            <div
                              className="h-full rounded-full bg-brand transition-all duration-500"
                              style={{ width: `${(completedCount / items.length) * 100}%` }}
                            />
                          </div>
                        )}
                        <div className="space-y-1.5">
                          {items.map((t) => {
                            const s = tasklistProgress[t.id] ?? "pending";
                            const si = statusIcon[s] ?? statusIcon.pending;
                            return (
                              <div key={t.id} className="flex items-center gap-2 text-[11px]">
                                <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-md border text-[10px] font-bold ${si.color}`}>
                                  {si.icon}
                                </span>
                                <span className={`min-w-0 flex-1 truncate ${s === "completed" ? "text-text-muted line-through" : "text-text-primary"}`} title={t.title}>
                                  {t.title}
                                </span>
                                {t.complexity && (
                                  <span className={`shrink-0 rounded px-1.5 py-0.5 font-medium ${cxColors[t.complexity] ?? "bg-surface-300 text-text-muted"}`}>
                                    {t.complexity}
                                  </span>
                                )}
                                <select
                                  value={t.suggested_model ?? ""}
                                  onChange={(e) => updateTaskModel(t.id, e.target.value)}
                                  className="shrink-0 rounded border border-status-pending/30 bg-status-pending/10 px-1 py-0.5 text-[10px] text-status-pending focus:border-status-pending focus:outline-none"
                                >
                                  <option value="">-</option>
                                  {modelOptions.map((m) => <option key={m} value={m}>{m}</option>)}
                                </select>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    );
                  } catch { return null; }
                })()}

                <div className="rounded-xl border border-border-default bg-surface-200 p-3">
                  <div className="mb-2 flex items-center justify-between">
                    <h4 className="text-xs font-medium text-text-secondary">Tasklist JSON</h4>
                    {selectedPlan && (
                      <span className="text-[11px] text-text-muted">
                        schema v{selectedPlan.tasklist_schema_version}
                      </span>
                    )}
                  </div>
                  <textarea
                    value={manualTasklistJsonText}
                    onChange={(e) => setManualTasklistJsonText(e.target.value)}
                    className={`${inputClass} min-h-[260px] resize-y font-mono text-[12px]`}
                    placeholder="{}"
                  />
                  {tasklistValidationError && (
                    <div className="mt-3 rounded-lg border border-error-border bg-error-bg px-3 py-2 text-xs text-error-text">
                      {tasklistValidationError}
                    </div>
                  )}
                  <div className="mt-3 flex flex-wrap gap-2">
                    <button
                      onClick={onValidateTasklist}
                      className={`${btnSecondary} !px-3 !py-1.5 text-xs`}
                    >
                      Validate
                    </button>
                    <button
                      onClick={onSaveManualRevision}
                      disabled={busy || !selectedPlan}
                      className={`${btnPrimary} !px-3 !py-1.5 text-xs`}
                    >
                      Save as New Version
                    </button>
                  </div>
                </div>
              </>
            )}

            {detailsTab === "run" && (
              <>
                <div className="rounded-xl border border-border-default bg-surface-200 p-3">
                  <div className="mb-3 flex items-center justify-between gap-2">
                    <div>
                      <p className="text-xs font-medium text-text-secondary">Execution</p>
                      {selectedProfile ? (
                        <p className="mt-1 text-[11px] text-text-muted">
                          {selectedProfile.agent_name} · {selectedProfile.model}
                        </p>
                      ) : (
                        <p className="mt-1 text-[11px] text-text-muted">Agent/model not selected for repo</p>
                      )}
                    </div>
                    <div className="flex items-center gap-1.5">
                      <button
                        onClick={onStartRun}
                        disabled={busy || !selectedProfileId || (taskRequiresPlan && !approvedPlan)}
                        className={`${btnPrimary} !px-3 !py-1.5 text-xs`}
                        title="Start a fresh run"
                      >
                        <span className="flex items-center gap-1.5">
                          <IconPlay className="h-3.5 w-3.5" />
                          New
                        </span>
                      </button>
                      {activeRun?.agent_session_id && (
                        <button
                          onClick={onResumeRun}
                          disabled={busy || !selectedProfileId || activeRun.status === "running"}
                          className={`${btnSecondary} !px-3 !py-1.5 text-xs`}
                          title="Resume previous agent session"
                        >
                          <span className="flex items-center gap-1.5">
                            <IconPlay className="h-3.5 w-3.5" />
                            Resume
                          </span>
                        </button>
                      )}
                    </div>
                  </div>
                  {selectedTask.use_worktree && !activeRun && (
                    <div className="mt-2">
                      <input
                        value={customBranchName}
                        onChange={(e) => setCustomBranchName(e.target.value)}
                        className="w-full rounded-lg border border-border-strong bg-surface-100 px-3 py-1.5 text-xs text-text-primary placeholder:text-text-muted focus:border-brand focus:outline-none"
                        placeholder="Branch name (auto-generated if empty)"
                      />
                    </div>
                  )}
                  <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px]">
                    {taskRequiresPlan && !approvedPlan && (
                      <span className="rounded-full border border-status-caution/40 bg-status-caution/10 px-2 py-0.5 text-status-caution">
                        Plan approval required
                      </span>
                    )}
                    {!taskRequiresPlan && (
                      <span className="rounded-full border border-brand/40 bg-brand-tint px-2 py-0.5 text-brand">
                        Direct run enabled
                      </span>
                    )}
                    {activeRun && (
                      <>
                        <span className={`rounded-full border px-2 py-0.5 font-medium ${runStatusColor(activeRun.status)}`}>
                          {activeRun.status}
                        </span>
                        {activeRun.branch_name && (
                          <span className="inline-flex items-center gap-1 rounded-full border border-border-strong bg-surface-300 px-2 py-0.5 text-text-secondary">
                            <IconGitBranch className="h-3 w-3" />
                            {activeRun.branch_name}
                          </span>
                        )}
                      </>
                    )}
                  </div>
                  {activeRun && !runFinished && (
                    <button
                      onClick={onStopRun}
                      className="mt-3 rounded-md border border-status-danger/30 bg-status-danger-soft px-3 py-1.5 text-xs font-medium text-status-danger transition hover:bg-status-danger/20"
                    >
                      Cancel Run
                    </button>
                  )}
                </div>

                <div className="rounded-xl border border-border-default bg-surface-200 p-3">
                  <h4 className="mb-2 text-xs font-medium text-text-secondary">Live Logs</h4>
                  <LogViewer
                    logs={runLogs}
                    className="h-[360px]"
                  />
                </div>

                {activeRun && (
                  <ChatPanel
                    isRunning={!!activeRun && !runFinished}
                    onSend={onSendChat}
                    onCancelQueued={onCancelQueuedChat}
                    messages={chatMessages}
                    queuedCount={chatQueuedCount}
                    agentProfiles={agentProfiles}
                    chatProfileId={chatProfileId}
                    onChatProfileChange={onChatProfileChange}
                  />
                )}

                <div className="rounded-xl border border-border-default bg-surface-200 p-3">
                  <h4 className="mb-2 text-xs font-medium text-text-secondary">Run Events</h4>
                  {!runResult ? (
                    <p className="rounded-lg border border-dashed border-border-strong px-3 py-6 text-center text-xs text-text-muted">
                      Run event summary will appear after completion.
                    </p>
                  ) : (
                    <div className="space-y-2">
                      {runResult.events.length === 0 && (
                        <p className="text-xs text-text-muted">No events recorded.</p>
                      )}
                      {runResult.events.map((event) => (
                        <div key={event.id} className="rounded-lg border border-border-strong bg-surface-100 px-3 py-2">
                          <div className="mb-1 flex items-center justify-between gap-2">
                            <span className="text-[11px] font-medium text-text-secondary">{event.type}</span>
                            <span className="text-[10px] text-text-muted">{formatDate(event.created_at)}</span>
                          </div>
                          <pre className="max-h-[140px] overflow-auto whitespace-pre-wrap text-[11px] text-text-muted">
                            {typeof event.payload === "string" ? event.payload : JSON.stringify(event.payload, null, 2)}
                          </pre>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </>
            )}

            {detailsTab === "review" && (
              <DiffReviewPanel
                selectedTask={selectedTask}
                reviewComments={reviewComments}
                reviewText={reviewText}
                setReviewText={setReviewText}
                runDiff={runDiff}
                runDiffLoading={runDiffLoading}
                reviewMode={reviewMode}
                setReviewMode={setReviewMode}
                batchLineComments={batchLineComments}
                setBatchLineComments={setBatchLineComments}
                lineSelection={lineSelection}
                draftText={draftText}
                setDraftText={setDraftText}
                applyConflicts={applyConflicts}
                gitStatus={gitStatus}
                busy={busy}
                onSubmitReview={onSubmitReview}
                onSubmitBatchReview={onSubmitBatchReview}
                onApplyToMain={onApplyToMain}
                onPushBranch={onPushBranch}
                onCreatePR={onCreatePR}
                onMarkTaskDone={onMarkTaskDone}
                onArchiveTask={onArchiveTask}
                onLineSelect={onLineSelect}
                onLineSave={onLineSave}
                onLineCancel={onLineCancel}
                onExpandReview={onExpandReview}
                agentProfiles={agentProfiles}
                reviewProfileId={reviewProfileId}
                onReviewProfileChange={onReviewProfileChange}
                carryDirtyState={carryDirtyState}
                onCarryDirtyStateChange={onCarryDirtyStateChange}
                onPinAsRule={onPinAsRule}
                onEditReviewComment={onEditReviewComment}
                onDeleteReviewComment={onDeleteReviewComment}
                onResendReviewComment={onResendReviewComment}
                onResolveConflicts={onResolveConflicts}
              />
            )}
          </div>
        </div>
      </aside>
    </>
  );
}
