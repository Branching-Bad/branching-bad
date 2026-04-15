import type { Task, Plan, PlanJob, AgentProfile, RunLogEntry, RunResponse, ReviewComment, LineComment, ActiveRun, ChatMessage, ApplyToMainOptions, GitStatusInfo } from "../types";
import { IconX, IconRocket, IconGitBranch, IconFastForward, IconDocument, IconBolt, IconExpand } from "./icons";
import { useEffect, useRef } from "react";
import { LogEntry } from "./LogEntry";
import { RunConversation } from "./RunConversation";
import { formatDate, laneFromStatus, inputClass, btnPrimary, btnSecondary, planStatusColor } from "./shared";
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

      <aside className="fixed inset-y-3 right-3 z-[42] flex w-full max-w-[540px] flex-col overflow-hidden rounded-[var(--radius-2xl)] border border-border-default bg-surface-100/90 shadow-[var(--shadow-lg)] backdrop-blur-md">
        {/* ── Header ─────────────────────────────────────────── */}
        <header className="border-b border-border-default bg-surface-100/70 px-5 pt-4 pb-3 backdrop-blur-md">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                {selectedTask.jira_issue_key && (
                  <span className="rounded-full bg-brand-tint px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-brand">
                    {selectedTask.jira_issue_key}
                  </span>
                )}
                <StatusPill status={selectedTask.status} />
              </div>
              <h3 className="mt-2 line-clamp-2 text-[14px] font-semibold leading-snug text-text-primary">
                {selectedTask.title}
              </h3>
            </div>
            <div className="flex items-center gap-1">
              <button
                onClick={onEditTask}
                className="rounded-full border border-border-default bg-surface-200 px-2.5 py-1 text-[11px] font-medium text-text-secondary transition hover:bg-surface-300 hover:text-text-primary"
              >
                Edit
              </button>
              {laneFromStatus(selectedTask.status) === "todo" && (
                <button
                  onClick={onDeleteTask}
                  className="rounded-full border border-status-danger/30 bg-status-danger-soft px-2.5 py-1 text-[11px] font-medium text-status-danger transition hover:bg-status-danger/20"
                >
                  Delete
                </button>
              )}
              <button
                onClick={onClose}
                aria-label="Close details"
                className="flex h-7 w-7 items-center justify-center rounded-full text-text-muted transition hover:bg-surface-200 hover:text-text-primary"
              >
                <IconX className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>

          {/* Meta chip row — priority + flag glyphs + updated */}
          <div className="mt-3 flex items-center gap-1.5 text-[10px] text-text-muted">
            {selectedTask.priority && <PriorityChip priority={selectedTask.priority} />}
            <FlagChip
              active={selectedTask.require_plan}
              tone="warning"
              title={selectedTask.require_plan ? "Require Plan" : "Direct Run"}
              icon={selectedTask.require_plan ? <IconDocument className="h-3 w-3" /> : <IconBolt className="h-3 w-3" />}
            />
            <FlagChip
              active={!!selectedTask.auto_approve_plan}
              tone="warning"
              title={selectedTask.auto_approve_plan ? "Auto Approve: On" : "Auto Approve: Off"}
              icon={<IconRocket className="h-3 w-3" />}
            />
            <FlagChip
              active={!!selectedTask.auto_start}
              tone="warning"
              title={selectedTask.auto_start ? "Autostart: On" : "Autostart: Off"}
              icon={<IconFastForward className="h-3 w-3" />}
            />
            <FlagChip
              active={!!selectedTask.use_worktree}
              tone="warning"
              title={selectedTask.use_worktree ? "Worktree" : "Direct"}
              icon={<IconGitBranch className="h-3 w-3" />}
            />
            <span className="ml-auto tabular-nums">{formatDate(selectedTask.updated_at)}</span>
          </div>

          {selectedTask.description && (
            <p className="mt-3 line-clamp-3 text-[12px] leading-relaxed text-text-secondary">
              {selectedTask.description}
            </p>
          )}

          {selectedTask.last_pipeline_error && (
            <div className="mt-3 rounded-[var(--radius-md)] border border-error-border bg-error-bg px-3 py-2 text-[11px] text-error-text">
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
                    className="rounded-full border border-error-border bg-error-bg/70 px-2.5 py-1 text-[11px] font-medium text-error-text transition hover:bg-surface-200 disabled:opacity-40"
                  >
                    Requeue
                  </button>
                )}
                <button
                  onClick={onClearTaskPipeline}
                  disabled={busy}
                  className="rounded-full border border-border-default bg-surface-200 px-2.5 py-1 text-[11px] font-medium text-text-secondary transition hover:bg-surface-300 hover:text-text-primary disabled:opacity-40"
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
                className="rounded-full border border-border-default bg-surface-200 px-2.5 py-1 text-[11px] font-medium text-text-secondary transition hover:bg-surface-300 hover:text-text-primary disabled:opacity-40"
                title="Clear stuck pipeline, reset task to TODO"
              >
                Clear Pipeline
              </button>
            </div>
          )}
        </header>

        {/* ── Segmented tab control ─────────────────────────── */}
        <div className="flex items-center gap-2 border-b border-border-default px-4 py-2">
          <div className="flex items-center gap-0.5 rounded-full border border-border-default bg-surface-200 p-0.5">
            <TabButton
              active={detailsTab === "plan"}
              onClick={() => setDetailsTab("plan")}
              label="Plan"
            />
            <TabButton
              active={detailsTab === "tasklist"}
              onClick={() => setDetailsTab("tasklist")}
              label="Tasklist"
            />
            <TabButton
              active={detailsTab === "run"}
              onClick={() => setDetailsTab("run")}
              label="Run"
            />
            {(selectedTask?.status === "IN_REVIEW" || selectedTask?.status === "DONE") && (
              <TabButton
                active={detailsTab === "review"}
                onClick={() => setDetailsTab("review")}
                label="Review"
                badge={reviewComments.length > 0 ? reviewComments.length : undefined}
              />
            )}
          </div>
          {(detailsTab === "plan" || detailsTab === "tasklist") && onExpandPlan && (
            <button
              onClick={onExpandPlan}
              title="Expand"
              className="ml-auto flex h-6 w-6 items-center justify-center rounded-full text-text-muted transition hover:bg-surface-200 hover:text-text-primary"
            >
              <IconExpand className="h-3 w-3" />
            </button>
          )}
        </div>

          <div className="flex-1 space-y-4 overflow-y-auto p-4">
            {detailsTab === "plan" && (
              <>
                {/* Compact header strip */}
                <div className="rounded-[var(--radius-lg)] border border-border-default bg-surface-100/70 px-3 py-2 backdrop-blur-sm">
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="flex min-w-0 items-center gap-1.5 text-[11px]">
                      <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                        (activePlanJob?.status === "running" || activePlanJob?.status === "pending")
                          ? "animate-pulse bg-brand"
                          : latestPlan?.status === "approved" ? "bg-status-success"
                          : latestPlan?.status === "drafted" ? "bg-status-warning"
                          : latestPlan?.status === "revise_requested" ? "bg-status-pending"
                          : "bg-text-muted"
                      }`} />
                      {latestPlan ? (
                        <>
                          <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.06em] ${planStatusColor(latestPlan.status)}`}>
                            {latestPlan.status}
                          </span>
                          <span className="text-text-muted">v{latestPlan.version}</span>
                        </>
                      ) : (
                        <span className="text-text-muted">No plan yet</span>
                      )}
                    </div>
                    <div className="ml-auto flex items-center gap-1.5">
                      {plans.length > 0 && (
                        <select
                          value={selectedPlanId}
                          onChange={(e) => setSelectedPlanId(e.target.value)}
                          className="rounded-full border border-border-default bg-surface-200 px-2.5 py-1 text-[11px] text-text-secondary focus:border-border-focus focus:outline-none"
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
                        className="rounded-full bg-brand px-3 py-1 text-[11px] font-semibold text-white shadow-[0_1px_2px_rgba(0,0,0,0.2)] transition hover:bg-brand-dark disabled:opacity-40"
                      >
                        {activePlanJob?.status === "running" || activePlanJob?.status === "pending"
                          ? "Planning…"
                          : (latestPlan ? "Regenerate" : "Generate")}
                      </button>
                    </div>
                  </div>
                  {!taskRequiresPlan && (
                    <p className="mt-2 text-[10px] text-text-muted">
                      Plan is optional for this task · you can run directly from the Run tab.
                    </p>
                  )}
                </div>

                {/* Live plan output — conversational feed when generating or when logs exist */}
                {(activePlanJob || planLogs.length > 0) && (
                  <PlanLiveOutput
                    logs={planLogs}
                    isRunning={activePlanJob?.status === "running" || activePlanJob?.status === "pending"}
                    finished={planFinished}
                  />
                )}

                {/* ── Review composer (YOU bubble) — moved above ─ */}
                <div className="flex justify-end">
                  <div className="w-full">
                    <div className="mb-1 flex items-center justify-end gap-1.5 pr-1">
                      <span className="text-[10px] font-semibold uppercase tracking-[0.1em] text-text-muted">You</span>
                      <span className="flex h-5 w-5 items-center justify-center rounded-full bg-brand-tint text-[10px] font-semibold text-brand">U</span>
                    </div>
                    <div className="rounded-[var(--radius-xl)] rounded-tr-[var(--radius-sm)] border border-brand/30 bg-brand-tint/60 p-3 shadow-[var(--shadow-sm)]">
                      <textarea
                        value={planComment}
                        onChange={(e) => setPlanComment(e.target.value)}
                        className="min-h-[64px] w-full resize-y bg-transparent text-[12px] leading-relaxed text-text-primary placeholder:text-text-muted focus:outline-none"
                        placeholder="Add an approval or revision note…"
                      />
                      {planActionInProgress ? (
                        <div className="mt-2 flex items-center gap-2 rounded-full bg-brand-tint px-3 py-1.5">
                          <span className="inline-block h-3 w-3 shrink-0 animate-spin rounded-full border-2 border-brand border-t-transparent" />
                          <span className="text-[11px] font-medium text-brand">{planActionInProgress}</span>
                        </div>
                      ) : (
                        <div className="mt-2 flex items-center gap-2 border-t border-brand/20 pt-2">
                          <button
                            onClick={() => onPlanAction("revise")}
                            disabled={busy || !latestPlan}
                            className="flex items-center gap-1.5 rounded-full border border-border-default bg-surface-200 px-3 py-1 text-[11px] font-medium text-text-secondary transition hover:bg-surface-300 hover:text-text-primary disabled:opacity-40"
                          >
                            <svg className="h-3 w-3" viewBox="0 0 12 12" fill="none">
                              <path d="M1.5 6A4.5 4.5 0 0 1 9.5 3M10.5 6A4.5 4.5 0 0 1 2.5 9M8 1l2 2-2 2M4 11l-2-2 2-2" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" fill="none" />
                            </svg>
                            Request revision
                          </button>
                          <button
                            onClick={() => onPlanAction("approve")}
                            disabled={busy || !latestPlan}
                            className="ml-auto flex items-center gap-1.5 rounded-full bg-status-success px-3 py-1 text-[11px] font-semibold text-white shadow-[0_1px_2px_rgba(0,0,0,0.2)] transition hover:brightness-110 disabled:opacity-40"
                          >
                            <svg className="h-3 w-3" viewBox="0 0 12 12" fill="none">
                              <path d="M2 6.3L5 9L10 3.3" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                            </svg>
                            Approve
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                {/* ── Plan Draft (AGENT bubble) — moved below ── */}
                <div className="flex justify-start">
                  <div className="w-full">
                    <div className="mb-1 flex items-center gap-1.5 pl-1">
                      <span className="flex h-5 w-5 items-center justify-center rounded-full bg-surface-300 text-[10px] font-semibold text-text-secondary">A</span>
                      <span className="text-[10px] font-semibold uppercase tracking-[0.1em] text-text-muted">Agent draft</span>
                      {selectedPlan && (
                        <>
                          <span className="rounded-full bg-surface-200 px-1.5 py-0 text-[10px] text-text-secondary">v{selectedPlan.version}</span>
                          <span className="text-[10px] text-text-muted">· {formatDate(selectedPlan.created_at)}</span>
                        </>
                      )}
                    </div>
                    <div className="rounded-[var(--radius-xl)] rounded-tl-[var(--radius-sm)] border border-border-default bg-surface-200 p-3 shadow-[var(--shadow-sm)]">
                      {selectedPlan ? (
                        <textarea
                          value={manualPlanMarkdown}
                          onChange={(e) => setManualPlanMarkdown(e.target.value)}
                          className="min-h-[240px] w-full resize-y bg-transparent font-mono text-[12px] leading-relaxed text-text-primary placeholder:text-text-muted focus:outline-none"
                          placeholder="Plan markdown…"
                        />
                      ) : (
                        <p className="rounded-[var(--radius-md)] border border-dashed border-border-default/60 px-3 py-6 text-center text-[12px] text-text-muted">
                          No plan yet · hit Generate above to draft one.
                        </p>
                      )}
                    </div>
                  </div>
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
              <RunConversation
                selectedProfile={selectedProfile}
                selectedProfileId={selectedProfileId}
                taskRequiresPlan={taskRequiresPlan}
                approvedPlan={approvedPlan}
                activeRun={activeRun}
                runLogs={runLogs}
                runFinished={runFinished}
                runResult={runResult}
                selectedTask={selectedTask}
                customBranchName={customBranchName}
                setCustomBranchName={setCustomBranchName}
                chatMessages={chatMessages}
                chatQueuedCount={chatQueuedCount}
                busy={busy}
                onStartRun={onStartRun}
                onResumeRun={onResumeRun}
                onStopRun={onStopRun}
                onSendChat={onSendChat}
                onCancelQueuedChat={onCancelQueuedChat}
                agentProfiles={agentProfiles}
                chatProfileId={chatProfileId}
                onChatProfileChange={onChatProfileChange}
              />
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
      </aside>
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers (declared after main component for readability)
// ─────────────────────────────────────────────────────────────────────────────

function TabButton({ active, onClick, label, badge }: { active: boolean; onClick: () => void; label: string; badge?: number }) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-1.5 rounded-full px-3 py-1 text-[12px] font-medium transition ${
        active
          ? "bg-surface-0 text-text-primary shadow-[0_1px_2px_rgba(0,0,0,0.2)]"
          : "text-text-muted hover:text-text-secondary"
      }`}
    >
      {label}
      {badge != null && (
        <span className={`inline-flex h-4 min-w-[16px] items-center justify-center rounded-full px-1 text-[9px] font-semibold ${active ? "bg-brand-tint text-brand" : "bg-surface-300 text-text-secondary"}`}>
          {badge}
        </span>
      )}
    </button>
  );
}

function StatusPill({ status }: { status: string }) {
  const upper = status.toUpperCase();
  const lane = laneFromStatus(status);
  const tone =
    lane === "done"
      ? "bg-status-success-soft text-status-success"
      : lane === "inreview"
      ? "bg-status-pending-soft text-status-pending"
      : lane === "inprogress" || upper === "PLAN_GENERATING" || upper === "PLAN_APPROVED"
      ? "bg-brand-tint text-brand"
      : upper === "PLAN_DRAFTED" || upper === "PLAN_REVISE_REQUESTED"
      ? "bg-status-warning-soft text-status-warning"
      : upper === "FAILED"
      ? "bg-status-danger-soft text-status-danger"
      : "bg-surface-200 text-text-secondary";
  return (
    <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.06em] ${tone}`}>
      {status}
    </span>
  );
}

function PriorityChip({ priority }: { priority: string }) {
  const p = priority.toLowerCase();
  const color =
    p === "highest" ? "#FF453A" :
    p === "high"    ? "#FF9F0A" :
    p === "medium"  ? "#FFD60A" :
    p === "low"     ? "#0A84FF" :
                      "#8E8E93";
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full bg-surface-200 px-1.5 py-0.5 text-[10px] font-medium text-text-secondary"
      title={`Priority: ${priority}`}
    >
      <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: color }} />
      {priority}
    </span>
  );
}

function PlanLiveOutput({ logs, isRunning, finished }: { logs: RunLogEntry[]; isRunning: boolean; finished: boolean }) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const filtered = logs.filter((l) => {
    if (l.type !== "db_event") return true;
    try { const p = JSON.parse(l.data) as { type?: string }; return !["tasklist_progress", "working_tree_diff", "run_finished"].includes(p.type ?? ""); }
    catch { return true; }
  });
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [filtered.length]);

  return (
    <div className="flex min-h-[200px] max-h-[420px] flex-col overflow-hidden rounded-[var(--radius-lg)] border border-border-default bg-surface-0/40">
      <div className="flex items-center justify-between border-b border-border-default/60 px-3 py-1.5">
        <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.1em] text-text-muted">
          {isRunning && <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-brand" />}
          Live output
        </div>
        {finished && !isRunning && (
          <span className="rounded-full bg-status-success-soft px-2 py-0.5 text-[10px] font-medium text-status-success">
            finished
          </span>
        )}
      </div>
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-3 py-2">
        {filtered.length === 0 ? (
          <div className="flex h-full min-h-[150px] items-center justify-center">
            <p className="text-[11px] text-text-muted">
              {isRunning ? "Waiting for output…" : "No output."}
            </p>
          </div>
        ) : (
          <div className="space-y-1">
            {filtered.map((log, i) => <LogEntry key={i} type={log.type} data={log.data} />)}
            {isRunning && (
              <div className="mt-2 flex items-center gap-1 px-1">
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-brand [animation-delay:0ms]" />
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-brand [animation-delay:150ms]" />
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-brand [animation-delay:300ms]" />
                <span className="ml-1 text-[10px] text-text-muted">planner working…</span>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function FlagChip({ active, icon, title }: { active: boolean; tone: "warning"; icon: React.ReactNode; title: string }) {
  return (
    <span
      title={title}
      className={`inline-flex h-5 w-5 items-center justify-center rounded-full transition ${
        active
          ? "bg-status-warning-soft text-status-warning"
          : "bg-surface-200 text-text-muted"
      }`}
    >
      {icon}
    </span>
  );
}
