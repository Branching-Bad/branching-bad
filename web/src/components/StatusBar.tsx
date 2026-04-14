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
      className="inline-block w-3.5 h-3.5 border-2 border-text-muted border-t-transparent rounded-full animate-spin"
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
  const className =
    "flex items-center gap-2 px-3 py-1.5 rounded-md bg-surface-200 border border-border-strong hover:bg-surface-300 transition-colors cursor-pointer text-left" +
    (exiting ? ` ${THANOS_SNAP_CLASS}` : "");
  return (
    <button
      type="button"
      onClick={() => onNavigate(run.taskId, run.repoId)}
      className={className}
    >
      {run.status === "running" && <RunSpinner />}
      {run.status === "done" && (
        <span className="text-status-success font-bold text-sm" aria-label="Done">✓</span>
      )}
      {run.status === "failed" && (
        <span className="text-status-danger font-bold text-sm" aria-label="Failed">✗</span>
      )}
      {run.status === "cancelled" && (
        <span className="text-text-muted text-sm" aria-label="Cancelled">⏸</span>
      )}

      <span className="flex flex-col min-w-0">
        <span className="text-text-primary text-xs font-medium truncate max-w-48">{run.taskTitle}</span>
        <span className="text-text-muted text-xs truncate">{run.repoName}</span>
      </span>

      {run.status === "running" && (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onCancel(run.runId); }}
          className="ml-1 px-2 py-0.5 rounded text-xs font-medium bg-status-danger/20 text-status-danger border border-status-danger/50 hover:bg-status-danger/30 transition-colors"
        >
          Cancel
        </button>
      )}
      {(run.status === "failed" || run.status === "cancelled") && (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onResume(run.runId); }}
          className="ml-1 px-2 py-0.5 rounded text-xs font-medium bg-brand/20 text-brand border border-brand/50 hover:bg-brand/30 transition-colors"
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
    <div className="fixed bottom-0 left-0 right-0 z-40 bg-surface-100 border-t border-border-strong px-4 py-2">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-text-muted text-xs font-medium mr-1 shrink-0">Runs:</span>
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
  );
}
