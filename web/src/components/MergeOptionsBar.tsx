import { useState } from "react";
import type { Task, MergeStrategy, ApplyToMainOptions, GitStatusInfo } from "../types";
import { IconGitBranch } from "./icons";

export function MergeOptionsBar({
  selectedTask,
  gitStatus,
  busy,
  onApplyToMain,
  onPushBranch,
  onCreatePR,
  onMarkTaskDone,
  onArchiveTask,
}: {
  selectedTask: Task;
  gitStatus?: GitStatusInfo | null;
  busy: boolean;
  onApplyToMain: (opts?: ApplyToMainOptions) => void;
  onPushBranch?: () => void;
  onCreatePR?: () => void;
  onMarkTaskDone: () => void;
  onArchiveTask?: () => void;
}) {
  const [autoCommit, setAutoCommit] = useState(true);
  const [commitMessage, setCommitMessage] = useState("");
  const [strategy, setStrategy] = useState<MergeStrategy>("squash");

  return (
    <>
      {/* Action buttons */}
      <div className="mb-3 flex items-center justify-end gap-2">
        {selectedTask.use_worktree !== false && (
          <button
            onClick={() => onApplyToMain({ autoCommit, commitMessage: commitMessage.trim() || undefined, strategy })}
            disabled={busy}
            className="rounded-md border border-border-strong bg-surface-100 px-3 py-1 text-xs font-medium text-text-secondary transition hover:bg-surface-200"
          >
            Apply to Main
          </button>
        )}
        {onPushBranch && (
          <button onClick={onPushBranch} disabled={busy} className="rounded-md border border-border-strong bg-surface-100 px-3 py-1 text-xs font-medium text-text-secondary transition hover:bg-surface-200">
            Push
          </button>
        )}
        {onCreatePR && (
          <button onClick={onCreatePR} disabled={busy} className="rounded-md border border-status-info/40 bg-status-info-soft px-3 py-1 text-xs font-medium text-status-info transition hover:bg-status-info/20 disabled:bg-surface-300/50 disabled:border-border-default disabled:text-text-muted disabled:cursor-not-allowed">
            Create PR
          </button>
        )}
        {selectedTask.status !== "DONE" && (
          <button
            onClick={onMarkTaskDone}
            disabled={busy}
            className="rounded-md border border-status-success/40 bg-status-success-soft px-3 py-1 text-xs font-medium text-status-success transition hover:bg-status-success/20 disabled:bg-surface-300/50 disabled:border-border-default disabled:text-text-muted disabled:cursor-not-allowed"
          >
            Mark as Done
          </button>
        )}
        {selectedTask.status === "DONE" && onArchiveTask && (
          <button
            onClick={onArchiveTask}
            disabled={busy}
            className="rounded-md border border-border-strong bg-surface-100 px-3 py-1 text-xs font-medium text-text-muted transition hover:bg-surface-200"
          >
            Archive
          </button>
        )}
      </div>

      {/* PR link */}
      {selectedTask.pr_url && (
        <div className="mb-3 flex items-center gap-2 rounded-lg border border-status-info/20 bg-status-info-soft px-3 py-1.5">
          <IconGitBranch className="h-3.5 w-3.5 text-status-info" />
          <a href={selectedTask.pr_url} target="_blank" rel="noopener noreferrer" className="text-xs text-status-info hover:underline">
            PR #{selectedTask.pr_number} — {selectedTask.pr_url}
          </a>
        </div>
      )}

      {/* Merge options */}
      {selectedTask.use_worktree !== false && (
        <div className="mb-3 flex flex-wrap items-center gap-3 rounded-lg border border-border-strong bg-surface-100 px-3 py-2">
          <div className="flex items-center gap-1.5">
            <span className="text-[11px] text-text-muted">Strategy:</span>
            <select
              value={strategy}
              onChange={(e) => setStrategy(e.target.value as MergeStrategy)}
              className="rounded border border-border-strong bg-surface-200 px-1.5 py-0.5 text-[11px] text-text-primary"
            >
              <option value="squash">Squash</option>
              <option value="merge">Merge</option>
              <option value="rebase">Rebase</option>
            </select>
          </div>
          <label className="flex items-center gap-1.5 text-[11px] text-text-muted cursor-pointer">
            <input type="checkbox" checked={autoCommit} onChange={(e) => setAutoCommit(e.target.checked)} className="rounded" />
            Auto-commit
          </label>
          {autoCommit && (
            <input
              type="text"
              value={commitMessage}
              onChange={(e) => setCommitMessage(e.target.value)}
              placeholder={`feat(${selectedTask.jira_issue_key}): ${selectedTask.title}`}
              className="flex-1 min-w-[200px] rounded border border-border-strong bg-surface-200 px-2 py-0.5 text-[11px] text-text-primary placeholder:text-text-muted"
            />
          )}
        </div>
      )}

      {/* Git status */}
      {gitStatus && gitStatus.commits.length > 0 && (
        <details className="mb-3 rounded-lg border border-border-strong bg-surface-100">
          <summary className="cursor-pointer px-3 py-2 text-[11px] font-medium text-text-secondary">
            {gitStatus.ahead} commit{gitStatus.ahead !== 1 ? "s" : ""} ahead
            {gitStatus.behind > 0 && `, ${gitStatus.behind} behind`}
          </summary>
          <div className="border-t border-border-strong px-3 py-2 space-y-0.5">
            {gitStatus.commits.map((c, i) => (
              <p key={i} className="text-[11px] text-text-muted font-mono">{c}</p>
            ))}
            {gitStatus.diffStat && (
              <pre className="mt-1 text-[10px] text-text-muted whitespace-pre-wrap">{gitStatus.diffStat}</pre>
            )}
          </div>
        </details>
      )}
    </>
  );
}
