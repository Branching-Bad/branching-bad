import type { GlobalActiveRun } from "../types";

interface Props {
  runs: GlobalActiveRun[];
  onCancel: (runId: string) => void;
  onResume: (runId: string) => void;
  onNavigate: (taskId: string, repoId: string) => void;
}

function RunSpinner() {
  return (
    <span
      className="inline-block w-3.5 h-3.5 border-2 border-zinc-400 border-t-transparent rounded-full animate-spin"
      aria-hidden="true"
    />
  );
}

function RunChip({
  run,
  onCancel,
  onResume,
  onNavigate,
}: {
  run: GlobalActiveRun;
  onCancel: (runId: string) => void;
  onResume: (runId: string) => void;
  onNavigate: (taskId: string, repoId: string) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onNavigate(run.taskId, run.repoId)}
      className="flex items-center gap-2 px-3 py-1.5 rounded-md bg-zinc-800 border border-zinc-700 hover:bg-zinc-700 transition-colors cursor-pointer text-left"
    >
      {run.status === "running" && <RunSpinner />}
      {run.status === "done" && (
        <span className="text-green-400 font-bold text-sm" aria-label="Done">✓</span>
      )}
      {run.status === "failed" && (
        <span className="text-red-400 font-bold text-sm" aria-label="Failed">✗</span>
      )}
      {run.status === "cancelled" && (
        <span className="text-zinc-400 text-sm" aria-label="Cancelled">⏸</span>
      )}

      <span className="flex flex-col min-w-0">
        <span className="text-zinc-200 text-xs font-medium truncate max-w-48">{run.taskTitle}</span>
        <span className="text-zinc-500 text-xs truncate">{run.repoName}</span>
      </span>

      {run.status === "running" && (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onCancel(run.runId); }}
          className="ml-1 px-2 py-0.5 rounded text-xs font-medium bg-red-900/60 text-red-300 border border-red-800 hover:bg-red-800/80 transition-colors"
        >
          Cancel
        </button>
      )}
      {(run.status === "failed" || run.status === "cancelled") && (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onResume(run.runId); }}
          className="ml-1 px-2 py-0.5 rounded text-xs font-medium bg-blue-900/60 text-blue-300 border border-blue-800 hover:bg-blue-800/80 transition-colors"
        >
          Resume
        </button>
      )}
    </button>
  );
}

export function StatusBar({ runs, onCancel, onResume, onNavigate }: Props) {
  if (runs.length === 0) return null;

  return (
    <div className="fixed bottom-0 left-0 right-0 z-40 bg-zinc-900 border-t border-zinc-700 px-4 py-2">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-zinc-500 text-xs font-medium mr-1 shrink-0">Runs:</span>
        {runs.map((run) => (
          <RunChip
            key={run.runId}
            run={run}
            onCancel={onCancel}
            onResume={onResume}
            onNavigate={onNavigate}
          />
        ))}
      </div>
    </div>
  );
}
