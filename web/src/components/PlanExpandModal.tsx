import { useEffect } from "react";
import type { Task, Plan, PlanJob, RunLogEntry } from "../types";
import { IconX } from "./icons";
import { LogViewer } from "./LogViewer";
import { formatDate, inputClass, selectClass, btnPrimary, btnSecondary, planStatusColor } from "./shared";

export function PlanExpandModal({
  open,
  onClose,
  selectedTask,
  plans, selectedPlanId, setSelectedPlanId,
  latestPlan,
  activePlanJob, planLogs, planFinished,
  taskRequiresPlan,
  planComment, setPlanComment,
  manualPlanMarkdown, setManualPlanMarkdown,
  manualPlanJsonText, setManualPlanJsonText,
  manualTasklistJsonText, setManualTasklistJsonText,
  tasklistValidationError,
  busy,
  onCreatePlan,
  onPlanAction,
  onValidateTasklist,
  onSaveManualRevision,
}: {
  open: boolean;
  onClose: () => void;
  selectedTask: Task;
  plans: Plan[]; selectedPlanId: string; setSelectedPlanId: (v: string) => void;
  latestPlan: Plan | null;
  activePlanJob: PlanJob | null; planLogs: RunLogEntry[]; planFinished: boolean;
  taskRequiresPlan: boolean;
  planComment: string; setPlanComment: (v: string) => void;
  manualPlanMarkdown: string; setManualPlanMarkdown: (v: string) => void;
  manualPlanJsonText: string; setManualPlanJsonText: (v: string) => void;
  manualTasklistJsonText: string; setManualTasklistJsonText: (v: string) => void;
  tasklistValidationError: string;
  busy: boolean;
  onCreatePlan: () => void;
  onPlanAction: (action: "approve" | "reject" | "revise") => void;
  onValidateTasklist: () => void;
  onSaveManualRevision: () => void;
}) {
  const selectedPlan = plans.find((p) => p.id === selectedPlanId) ?? latestPlan;

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, onClose]);

  if (!open) return null;

  const modelOptions = ["haiku", "sonnet", "opus"];

  // Parse tasklist for overview
  let tasklistOverview: React.ReactNode = null;
  try {
    const tl = JSON.parse(manualTasklistJsonText);
    const phases = tl?.phases as Array<{ id: string; name: string; tasks: Array<{ id: string; title: string; complexity?: string; suggested_model?: string }> }> | undefined;
    if (phases?.length) {
      const items = phases.flatMap((p) => p.tasks ?? []);
      if (items.some((t) => t.complexity || t.suggested_model)) {
        const cxColors: Record<string, string> = { low: "bg-blue-500/15 text-blue-400", medium: "bg-orange-500/15 text-orange-400", high: "bg-red-500/15 text-red-400" };
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
        tasklistOverview = (
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
                  <select
                    value={t.suggested_model ?? ""}
                    onChange={(e) => updateTaskModel(t.id, e.target.value)}
                    className="shrink-0 rounded border border-purple-500/30 bg-purple-500/10 px-1 py-0.5 text-[10px] text-purple-400 focus:border-purple-400 focus:outline-none"
                  >
                    <option value="">-</option>
                    {modelOptions.map((m) => <option key={m} value={m}>{m}</option>)}
                  </select>
                </div>
              ))}
            </div>
          </div>
        );
      }
    }
  } catch { /* ignore */ }

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative flex h-[85vh] w-full max-w-[86%] flex-col overflow-hidden rounded-2xl border border-border-default bg-surface-100 shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border-default px-5 py-3">
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-text-primary">
              Plan {selectedTask.jira_issue_key && <>— {selectedTask.jira_issue_key}</>}{" "}
              <span className="font-normal text-text-secondary">{selectedTask.title}</span>
            </h2>
          </div>
          <button
            onClick={onClose}
            className="rounded-md p-1 text-text-muted transition hover:bg-surface-300 hover:text-text-primary"
          >
            <IconX className="h-4 w-4" />
          </button>
        </div>

        {/* Body — two columns */}
        <div className="flex flex-1 overflow-hidden">
          {/* Left sidebar */}
          <div className="w-56 shrink-0 overflow-y-auto border-r border-border-default bg-surface-200 p-3 space-y-4">
            {/* Plan status */}
            <div className="space-y-2">
              <h3 className="text-[10px] font-semibold uppercase tracking-wider text-text-muted">Status</h3>
              {latestPlan ? (
                <div className="flex items-center gap-2">
                  <span className={`rounded-full border px-2 py-0.5 text-[11px] font-medium ${planStatusColor(latestPlan.status)}`}>
                    {latestPlan.status}
                  </span>
                  <span className="text-[11px] text-text-muted">v{latestPlan.version}</span>
                </div>
              ) : (
                <span className="text-xs text-text-muted">No plan</span>
              )}
              {!taskRequiresPlan && (
                <p className="text-[10px] text-text-muted">Plan optional for this task.</p>
              )}
            </div>

            {/* Version select */}
            {plans.length > 0 && (
              <div className="space-y-1.5">
                <h3 className="text-[10px] font-semibold uppercase tracking-wider text-text-muted">Version</h3>
                <select
                  value={selectedPlanId}
                  onChange={(e) => setSelectedPlanId(e.target.value)}
                  className={`${selectClass} !w-full !py-1.5 !text-xs`}
                >
                  {plans.map((plan) => (
                    <option key={plan.id} value={plan.id}>
                      v{plan.version} · {plan.status}
                    </option>
                  ))}
                </select>
              </div>
            )}

            <div className="border-t border-border-default" />

            {/* Comment */}
            <div className="space-y-1.5">
              <h3 className="text-[10px] font-semibold uppercase tracking-wider text-text-muted">Comment</h3>
              <textarea
                value={planComment}
                onChange={(e) => setPlanComment(e.target.value)}
                className={`${inputClass} min-h-[80px] resize-y text-xs`}
                placeholder="Add approval/revision note..."
              />
            </div>

            {/* Actions */}
            <div className="flex flex-col gap-2">
              <button
                onClick={() => onPlanAction("approve")}
                disabled={busy || !latestPlan}
                className={`${btnPrimary} !py-1.5 text-xs w-full`}
              >
                Approve
              </button>
              <button
                onClick={() => onPlanAction("revise")}
                disabled={busy || !latestPlan}
                className={`${btnSecondary} !py-1.5 text-xs w-full`}
              >
                Request Revision
              </button>
              <button
                onClick={() => onPlanAction("reject")}
                disabled={busy || !latestPlan}
                className="w-full rounded-md border border-error-border bg-error-bg py-1.5 text-xs font-medium text-error-text transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40"
              >
                Reject
              </button>
            </div>

            <div className="border-t border-border-default" />

            {/* Generate */}
            <button
              onClick={onCreatePlan}
              disabled={busy || activePlanJob?.status === "running" || activePlanJob?.status === "pending"}
              className={`${btnPrimary} !py-1.5 text-xs w-full`}
            >
              {activePlanJob?.status === "running" || activePlanJob?.status === "pending"
                ? "Planning..."
                : (latestPlan ? "Regenerate" : "Generate Plan")}
            </button>

            {activePlanJob && (
              <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
                <span className={`rounded-full border px-2 py-0.5 font-medium ${
                  activePlanJob.status === "done"
                    ? "border-brand/40 bg-brand-tint text-brand"
                    : activePlanJob.status === "failed"
                      ? "border-error-border bg-error-bg text-error-text"
                      : "border-border-strong bg-surface-300 text-text-secondary"
                }`}>
                  {activePlanJob.status}
                </span>
                <span className="text-text-muted">{activePlanJob.mode}</span>
              </div>
            )}
          </div>

          {/* Right panel — scrollable */}
          <div className="flex-1 overflow-y-auto p-4 space-y-4">
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
                  className={`${inputClass} min-h-[300px] resize-y font-mono text-[12px] leading-relaxed`}
                  placeholder="Plan markdown..."
                />
              ) : (
                <p className="rounded-lg border border-dashed border-border-strong px-3 py-6 text-center text-xs text-text-muted">
                  Select a task and generate a plan to see details.
                </p>
              )}
            </div>

            {/* Plan JSON */}
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
                className={`${inputClass} min-h-[200px] resize-y font-mono text-[12px]`}
                placeholder="{}"
              />
            </div>

            {/* Tasklist Overview */}
            {tasklistOverview}

            {/* Tasklist JSON */}
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
                className="h-[300px]"
                emptyMessage={
                  activePlanJob
                    ? (planFinished ? "Plan output stream finished." : "Waiting for plan output...")
                    : "No active plan job."
                }
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
