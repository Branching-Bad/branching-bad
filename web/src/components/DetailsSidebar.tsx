import type { Task, Plan, PlanJob, AgentProfile, RunLogEntry, RunResponse, ReviewComment, LineComment, ActiveRun } from "../types";
import { IconX, IconPlay, IconRocket, IconGitBranch, IconFastForward, IconDocument, IconBolt, IconArrowUp, IconArrowDown } from "./icons";
import { LogViewer } from "./LogViewer";
import { formatDate, laneFromStatus, inputClass, selectClass, btnPrimary, btnSecondary, planStatusColor, runStatusColor } from "./shared";
import { DiffReviewPanel } from "./DiffReviewPanel";

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
  planComment, setPlanComment,
  manualPlanMarkdown, setManualPlanMarkdown,
  manualPlanJsonText, setManualPlanJsonText,
  manualTasklistJsonText, setManualTasklistJsonText,
  tasklistValidationError,
  reviewComments, reviewText, setReviewText,
  runDiff, runDiffLoading,
  reviewMode, setReviewMode,
  batchLineComments, setBatchLineComments,
  lineSelection, draftText, setDraftText,
  applyConflicts,
  busy,
  onClose,
  onEditTask, onDeleteTask,
  onCreatePlan, onPlanAction, onValidateTasklist, onSaveManualRevision,
  onStartRun, onStopRun,
  onSubmitReview, onSubmitBatchReview, onApplyToMain, onMarkTaskDone,
  onLineSelect, onLineSave, onLineCancel,
  onRequeueAutostart, onClearTaskPipeline,
  onExpandReview,
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
  planComment: string; setPlanComment: (v: string) => void;
  manualPlanMarkdown: string; setManualPlanMarkdown: (v: string) => void;
  manualPlanJsonText: string; setManualPlanJsonText: (v: string) => void;
  manualTasklistJsonText: string; setManualTasklistJsonText: (v: string) => void;
  tasklistValidationError: string;
  reviewComments: ReviewComment[]; reviewText: string; setReviewText: (v: string) => void;
  runDiff: string; runDiffLoading: boolean;
  reviewMode: "instant" | "batch"; setReviewMode: (v: "instant" | "batch") => void;
  batchLineComments: LineComment[]; setBatchLineComments: (v: LineComment[]) => void;
  lineSelection: { filePath: string; lineStart: number; lineEnd: number; hunk: string; anchorKey: string } | null;
  draftText: string; setDraftText: (v: string) => void;
  applyConflicts: string[];
  busy: boolean;
  onClose: () => void;
  onEditTask: () => void;
  onDeleteTask: () => void;
  onCreatePlan: () => void;
  onPlanAction: (action: "approve" | "reject" | "revise") => void;
  onValidateTasklist: () => void;
  onSaveManualRevision: () => void;
  onStartRun: () => void;
  onStopRun: () => void;
  onSubmitReview: () => void;
  onSubmitBatchReview: () => void;
  onApplyToMain: () => void;
  onMarkTaskDone: () => void;
  onLineSelect: (filePath: string, lineStart: number, lineEnd: number, hunk: string, anchorKey: string) => void;
  onLineSave: () => void;
  onLineCancel: () => void;
  onRequeueAutostart: () => void;
  onClearTaskPipeline: () => void;
  onExpandReview?: () => void;
}) {
  const selectedPlan = plans.find((p) => p.id === selectedPlanId) ?? latestPlan;

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
                    className="rounded-md border border-red-500/40 bg-red-500/10 px-2 py-1 text-[11px] font-medium text-red-400 transition hover:bg-red-500/20 hover:text-red-300"
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
                      ? "border-red-500/40 bg-red-500/10 text-red-400"
                      : selectedTask.priority === "medium"
                        ? "border-orange-500/40 bg-orange-500/10 text-orange-400"
                        : "border-blue-500/40 bg-blue-500/10 text-blue-400"
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
                    ? "border-orange-500/40 bg-orange-500/10 text-orange-400"
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
                    ? "border-orange-500/40 bg-orange-500/10 text-orange-400"
                    : "border-border-strong bg-surface-300 text-text-muted"
                }`}
              >
                <IconRocket className="h-3 w-3" />
              </span>
              <span
                title={selectedTask.auto_start ? "Autostart: On" : "Autostart: Off"}
                className={`inline-flex items-center rounded-full border p-1 ${
                  selectedTask.auto_start
                    ? "border-orange-500/40 bg-orange-500/10 text-orange-400"
                    : "border-border-strong bg-surface-300 text-text-muted"
                }`}
              >
                <IconFastForward className="h-3 w-3" />
              </span>
              <span
                title={selectedTask.use_worktree ? "Worktree" : "Direct"}
                className={`inline-flex items-center rounded-full border p-1 ${
                  selectedTask.use_worktree
                    ? "border-orange-500/40 bg-orange-500/10 text-orange-400"
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
                      className="rounded-md border border-error-border bg-error-bg px-2.5 py-1 text-[11px] font-medium text-error-text transition hover:brightness-110 disabled:opacity-40"
                    >
                      Requeue Pipeline
                    </button>
                  )}
                  <button
                    onClick={onClearTaskPipeline}
                    disabled={busy}
                    className="rounded-md border border-border-default bg-surface-secondary px-2.5 py-1 text-[11px] font-medium text-text-secondary transition hover:brightness-110 disabled:opacity-40"
                    title="Takılmış plan job ve autostart job'ları temizle, task'ı TODO'ya döndür"
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
                  className="rounded-md border border-border-default bg-surface-secondary px-2.5 py-1 text-[11px] font-medium text-text-secondary transition hover:brightness-110 disabled:opacity-40"
                  title="Takılmış pipeline'ı temizle, task'ı TODO'ya döndür"
                >
                  Clear Pipeline
                </button>
              </div>
            )}
          </div>

          <div className="flex border-b border-border-default px-3">
            <button
              onClick={() => setDetailsTab("plan")}
              className={`relative px-3 py-2.5 text-sm font-medium transition ${
                detailsTab === "plan" ? "text-brand" : "text-text-muted hover:text-text-secondary"
              }`}
            >
              Plan
              {detailsTab === "plan" && <span className="absolute bottom-0 left-0 right-0 h-[2px] bg-brand" />}
            </button>
            <button
              onClick={() => setDetailsTab("tasklist")}
              className={`relative px-3 py-2.5 text-sm font-medium transition ${
                detailsTab === "tasklist" ? "text-brand" : "text-text-muted hover:text-text-secondary"
              }`}
            >
              Tasklist
              {detailsTab === "tasklist" && <span className="absolute bottom-0 left-0 right-0 h-[2px] bg-brand" />}
            </button>
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

                <div className="rounded-xl border border-border-default bg-surface-200 p-3">
                  <label className="mb-1.5 block text-xs font-medium text-text-muted">Review Comment</label>
                  <textarea
                    value={planComment}
                    onChange={(e) => setPlanComment(e.target.value)}
                    className={`${inputClass} min-h-[84px] resize-y`}
                    placeholder="Add approval/revision note..."
                  />
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
                      className="rounded-md border border-error-border bg-error-bg px-3 py-1.5 text-xs font-medium text-error-text transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      Reject
                    </button>
                  </div>
                </div>

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
              </>
            )}

            {detailsTab === "tasklist" && (
              <>
                <div className="rounded-xl border border-border-default bg-surface-200 p-3">
                  <div className="mb-2 flex items-center justify-between">
                    <h4 className="text-xs font-medium text-text-secondary">Plan JSON</h4>
                    {selectedPlan && (
                      <span className="text-[11px] text-text-muted">
                        v{selectedPlan.version} · {selectedPlan.generation_mode}
                      </span>
                    )}
                  </div>
                  <textarea
                    value={manualPlanJsonText}
                    onChange={(e) => setManualPlanJsonText(e.target.value)}
                    className={`${inputClass} min-h-[180px] resize-y font-mono text-[12px]`}
                    placeholder="{}"
                  />
                </div>

                {/* Tasklist Summary */}
                {(() => {
                  try {
                    const tl = JSON.parse(manualTasklistJsonText);
                    const phases = tl?.phases as Array<{ id: string; name: string; tasks: Array<{ id: string; title: string; complexity?: string; suggested_model?: string }> }> | undefined;
                    if (!phases?.length) return null;
                    const items = phases.flatMap((p) => p.tasks ?? []);
                    if (!items.some((t) => t.complexity || t.suggested_model)) return null;
                    const cxColors: Record<string, string> = { low: "bg-blue-500/15 text-blue-400", medium: "bg-orange-500/15 text-orange-400", high: "bg-red-500/15 text-red-400" };
                    return (
                      <div className="rounded-xl border border-border-default bg-surface-200 p-3">
                        <h4 className="mb-2 text-xs font-medium text-text-secondary">Tasklist Overview</h4>
                        <div className="space-y-1.5">
                          {items.map((t) => (
                            <div key={t.id} className="flex items-center gap-2 text-[11px]">
                              <span className="min-w-0 flex-1 truncate text-text-primary" title={t.title}>{t.id}: {t.title}</span>
                              {t.complexity && (
                                <span className={`shrink-0 rounded px-1.5 py-0.5 font-medium ${cxColors[t.complexity] ?? "bg-surface-300 text-text-muted"}`}>
                                  {t.complexity}
                                </span>
                              )}
                              {t.suggested_model && (
                                <span className="shrink-0 rounded bg-purple-500/10 px-1.5 py-0.5 text-purple-400">
                                  {t.suggested_model}
                                </span>
                              )}
                            </div>
                          ))}
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
                    <button
                      onClick={onStartRun}
                      disabled={busy || !selectedProfileId || (taskRequiresPlan && !approvedPlan)}
                      className={`${btnPrimary} !px-3 !py-1.5 text-xs`}
                    >
                      <span className="flex items-center gap-1.5">
                        <IconPlay className="h-3.5 w-3.5" />
                        Start Run
                      </span>
                    </button>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 text-[11px]">
                    {taskRequiresPlan && !approvedPlan && (
                      <span className="rounded-full border border-yellow-700 bg-yellow-950/40 px-2 py-0.5 text-yellow-400">
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
                        <span className="rounded-full border border-border-strong bg-surface-300 px-2 py-0.5 text-text-secondary">
                          {activeRun.branch_name}
                        </span>
                      </>
                    )}
                  </div>
                  {activeRun && !runFinished && (
                    <button
                      onClick={onStopRun}
                      className="mt-3 rounded-md border border-error-border bg-error-bg px-3 py-1.5 text-xs font-medium text-error-text transition hover:brightness-110"
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
                busy={busy}
                onSubmitReview={onSubmitReview}
                onSubmitBatchReview={onSubmitBatchReview}
                onApplyToMain={onApplyToMain}
                onMarkTaskDone={onMarkTaskDone}
                onLineSelect={onLineSelect}
                onLineSave={onLineSave}
                onLineCancel={onLineCancel}
                onExpandReview={onExpandReview}
              />
            )}
          </div>
        </div>
      </aside>
    </>
  );
}
