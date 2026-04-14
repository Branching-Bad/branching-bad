import { THANOS_SNAP_CLASS } from "../effects/thanos-snap";
import type { GlobalActiveRun } from "../types";

interface Props {
  runs: GlobalActiveRun[];
  exitingRunIds?: Set<string>;
  onCancel: (runId: string) => void;
  onResume: (runId: string) => void;
  onNavigate: (taskId: string, repoId: string) => void;
}

function RunSpinner() {
  return (
    <span
      className="inline-block w-3 h-3 border-2 border-brand border-t-transparent rounded-full animate-spin"
      aria-hidden="true"
    />
  );
}

function RunChip({
  run,
  exiting,
  onCancel,
  onResume,
  onNavigate,
}: {
  run: GlobalActiveRun;
  exiting: boolean;
  onCancel: (runId: string) => void;
  onResume: (runId: string) => void;
  onNavigate: (taskId: string, repoId: string) => void;
}) {
  const statusTone =
    run.status === "running"
      ? "border-brand/40 bg-brand-tint"
      : run.status === "done"
      ? "border-status-success/40 bg-status-success-soft"
      : run.status === "failed"
      ? "border-status-danger/40 bg-status-danger-soft"
      : "border-border-default bg-surface-200";

  const className =
    `flex items-center gap-2 rounded-full border px-3 py-1.5 text-left transition hover:brightness-110 cursor-pointer ${statusTone}` +
    (exiting ? ` ${THANOS_SNAP_CLASS}` : "");

  return (
    <button
      type="button"
      onClick={() => onNavigate(run.taskId, run.repoId)}
      className={className}
    >
      {run.status === "running" && <RunSpinner />}
      {run.status === "done" && (
        <svg className="h-3 w-3 text-status-success" viewBox="0 0 12 12" fill="none" aria-label="Done">
          <path d="M2.5 6.3L5 8.7L9.5 3.3" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      )}
      {run.status === "failed" && (
        <svg className="h-3 w-3 text-status-danger" viewBox="0 0 12 12" fill="none" aria-label="Failed">
          <path d="M3 3l6 6M9 3l-6 6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        </svg>
      )}
      {run.status === "cancelled" && (
        <svg className="h-3 w-3 text-text-muted" viewBox="0 0 12 12" fill="none" aria-label="Cancelled">
          <rect x="3" y="2.5" width="2" height="7" rx="0.5" fill="currentColor" />
          <rect x="7" y="2.5" width="2" height="7" rx="0.5" fill="currentColor" />
        </svg>
      )}

      <span className="flex min-w-0 flex-col">
        <span className="max-w-48 truncate text-[11px] font-medium text-text-primary">{run.taskTitle}</span>
        <span className="truncate text-[10px] text-text-muted">{run.repoName}</span>
      </span>

      {run.status === "running" && (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onCancel(run.runId); }}
          className="ml-1 rounded-full bg-status-danger-soft px-2 py-0.5 text-[10px] font-medium text-status-danger transition hover:bg-status-danger/20"
        >
          Cancel
        </button>
      )}
      {(run.status === "failed" || run.status === "cancelled") && (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onResume(run.runId); }}
          className="ml-1 rounded-full bg-brand-tint px-2 py-0.5 text-[10px] font-medium text-brand transition hover:bg-brand/20"
        >
          Resume
        </button>
      )}
    </button>
  );
}

export function StatusBar({ runs, exitingRunIds, onCancel, onResume, onNavigate }: Props) {
  if (runs.length === 0) return null;

  return (
    <div className="fixed bottom-3 left-1/2 z-40 -translate-x-1/2">
      <div className="flex items-center gap-2 rounded-full border border-border-default bg-surface-100/80 px-3 py-1.5 shadow-[var(--shadow-lg)] backdrop-blur-md">
        <span className="shrink-0 text-[10px] font-semibold uppercase tracking-[0.1em] text-text-muted">Runs</span>
        <div className="flex flex-wrap items-center gap-1.5">
          {runs.map((run) => (
            <RunChip
              key={run.runId}
              run={run}
              exiting={exitingRunIds?.has(run.runId) ?? false}
              onCancel={onCancel}
              onResume={onResume}
              onNavigate={onNavigate}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
