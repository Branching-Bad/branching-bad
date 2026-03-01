import type { Task, ReviewComment, LineComment, ApplyToMainOptions, GitStatusInfo, AgentProfile } from "../types";
import { AgentProfileSelect } from "./AgentProfileSelect";
import { DiffViewer } from "./DiffViewer";
import { IconExpand } from "./icons";
import { MergeOptionsBar } from "./MergeOptionsBar";
import { formatDate } from "./shared";

type Selection = {
  filePath: string;
  lineStart: number;
  lineEnd: number;
  hunk: string;
  anchorKey: string;
};

export function DiffReviewPanel({
  selectedTask,
  reviewComments,
  reviewText,
  setReviewText,
  runDiff,
  runDiffLoading,
  reviewMode,
  setReviewMode,
  batchLineComments,
  setBatchLineComments,
  lineSelection,
  draftText,
  setDraftText,
  applyConflicts,
  gitStatus,
  busy,
  onSubmitReview,
  onSubmitBatchReview,
  onApplyToMain,
  onPushBranch,
  onCreatePR,
  onMarkTaskDone,
  onLineSelect,
  onLineSave,
  onLineCancel,
  onExpandReview,
  agentProfiles,
  reviewProfileId,
  onReviewProfileChange,
}: {
  selectedTask: Task;
  reviewComments: ReviewComment[];
  reviewText: string;
  setReviewText: (v: string) => void;
  runDiff: string;
  runDiffLoading: boolean;
  reviewMode: "instant" | "batch";
  setReviewMode: (v: "instant" | "batch") => void;
  batchLineComments: LineComment[];
  setBatchLineComments: (v: LineComment[]) => void;
  lineSelection: Selection | null;
  draftText: string;
  setDraftText: (v: string) => void;
  applyConflicts: string[];
  gitStatus?: GitStatusInfo | null;
  busy: boolean;
  onSubmitReview: () => void;
  onSubmitBatchReview: () => void;
  onApplyToMain: (opts?: ApplyToMainOptions) => void;
  onPushBranch?: () => void;
  onCreatePR?: () => void;
  onMarkTaskDone: () => void;
  onLineSelect: (filePath: string, lineStart: number, lineEnd: number, hunk: string, anchorKey: string) => void;
  onLineSave: () => void;
  onLineCancel: () => void;
  onExpandReview?: () => void;
  agentProfiles?: AgentProfile[];
  reviewProfileId?: string;
  onReviewProfileChange?: (v: string) => void;
}) {
  return (
    <div className="rounded-xl border border-border-default bg-surface-200 p-3">
      {/* Header */}
      <div className="mb-3 flex items-center gap-1.5">
        <h4 className="text-xs font-medium text-text-secondary">Review Feedback</h4>
        {onExpandReview && (
          <button onClick={onExpandReview} title="Expand" className="rounded-md p-0.5 text-text-muted transition hover:bg-surface-300 hover:text-text-primary">
            <IconExpand className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      {/* Merge options, PR link, git status, action buttons */}
      <MergeOptionsBar
        selectedTask={selectedTask}
        gitStatus={gitStatus}
        busy={busy}
        onApplyToMain={onApplyToMain}
        onPushBranch={onPushBranch}
        onCreatePR={onCreatePR}
        onMarkTaskDone={onMarkTaskDone}
      />

      {/* Conflict display */}
      {applyConflicts.length > 0 && (
        <div className="mb-3 rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2">
          <p className="mb-1 text-xs font-medium text-red-400">
            Merge Conflicts ({applyConflicts.length} {applyConflicts.length === 1 ? "file" : "files"})
          </p>
          <ul className="mb-1 space-y-0.5">
            {applyConflicts.map((f) => (
              <li key={f} className="text-[11px] text-red-300">- {f}</li>
            ))}
          </ul>
          <p className="text-[10px] text-red-400/70">
            Resolve conflicts on the task branch before applying.
          </p>
        </div>
      )}

      {/* Mode toggle */}
      <div className="mb-3 flex items-center gap-1 rounded-lg border border-border-strong bg-surface-300 p-0.5">
        <button
          onClick={() => setReviewMode("batch")}
          className={`flex-1 rounded-md px-2 py-1 text-[11px] font-medium transition ${
            reviewMode === "batch"
              ? "bg-surface-100 text-text-primary shadow-sm"
              : "text-text-muted hover:text-text-secondary"
          }`}
        >
          Batch Review
        </button>
        <button
          onClick={() => setReviewMode("instant")}
          className={`flex-1 rounded-md px-2 py-1 text-[11px] font-medium transition ${
            reviewMode === "instant"
              ? "bg-surface-100 text-text-primary shadow-sm"
              : "text-text-muted hover:text-text-secondary"
          }`}
        >
          Instant
        </button>
      </div>

      {/* Diff viewer */}
      {runDiffLoading ? (
        <div className="mb-3 flex items-center justify-center rounded-lg border border-dashed border-border-strong py-6">
          <span className="text-xs text-text-muted animate-pulse">Loading diff...</span>
        </div>
      ) : runDiff ? (
        <div className="mb-3">
          <DiffViewer
            diffText={runDiff}
            batchComments={batchLineComments}
            selection={lineSelection}
            draftText={draftText}
            reviewMode={reviewMode}
            onLineSelect={onLineSelect}
            onDraftChange={setDraftText}
            onCommentSave={onLineSave}
            onCommentCancel={onLineCancel}
          />
        </div>
      ) : null}

      {/* Batch comments list */}
      {reviewMode === "batch" && batchLineComments.length > 0 && (
        <div className="mb-3 space-y-1">
          <h5 className="text-[11px] font-medium text-text-secondary">
            Pending Comments ({batchLineComments.length})
          </h5>
          {batchLineComments.map((lc, idx) => (
            <div
              key={idx}
              className="flex items-start justify-between rounded-lg border border-brand/20 bg-brand/5 px-2 py-1.5"
            >
              <div className="min-w-0 flex-1">
                <span className="text-[10px] font-medium text-brand">
                  {lc.filePath}:{lc.lineStart === lc.lineEnd ? lc.lineStart : `${lc.lineStart}-${lc.lineEnd}`}
                </span>
                <p className="mt-0.5 text-[11px] text-text-secondary">{lc.text}</p>
              </div>
              <button
                onClick={() => setBatchLineComments(batchLineComments.filter((_, i) => i !== idx))}
                className="ml-2 shrink-0 text-text-muted hover:text-red-400"
                title="Remove"
              >
                <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          ))}
        </div>
      )}

      {/* General comment textarea */}
      <textarea
        value={reviewText}
        onChange={(e) => setReviewText(e.target.value)}
        placeholder="General feedback (optional with line comments)..."
        rows={3}
        className="w-full rounded-lg border border-border-strong bg-surface-100 px-3 py-2 text-xs text-text-primary placeholder:text-text-muted focus:border-brand focus:outline-none"
      />

      {/* Submit area */}
      <div className="mt-2 flex items-center gap-2">
        {agentProfiles && onReviewProfileChange && (
          <AgentProfileSelect profiles={agentProfiles} value={reviewProfileId ?? ""} onChange={onReviewProfileChange} />
        )}
        {reviewMode === "batch" ? (
          <button
            onClick={onSubmitBatchReview}
            disabled={busy || (batchLineComments.length === 0 && !reviewText.trim())}
            className="rounded-md bg-brand px-3 py-1.5 text-xs font-medium text-white transition hover:brightness-110 disabled:opacity-50"
          >
            Review Gonder ({batchLineComments.length + (reviewText.trim() ? 1 : 0)} comment)
          </button>
        ) : (
          <button
            onClick={onSubmitReview}
            disabled={busy || !reviewText.trim()}
            className="rounded-md bg-brand px-3 py-1.5 text-xs font-medium text-white transition hover:brightness-110 disabled:opacity-50"
          >
            Submit Feedback
          </button>
        )}
      </div>

      {/* Past review comments */}
      {reviewComments.length > 0 && (
        <div className="mt-3 space-y-2">
          <h5 className="text-[11px] font-medium text-text-secondary">Review History</h5>
          {reviewComments.map((rc) => (
            <div key={rc.id} className="rounded-lg border border-border-strong bg-surface-100 px-3 py-2">
              <div className="mb-1 flex items-center gap-2">
                {rc.status === "processing" && (
                  <span className="inline-flex items-center gap-1 text-[10px] font-medium text-blue-400">
                    <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-blue-400" />
                    Processing
                  </span>
                )}
                {rc.status === "addressed" && (
                  <span
                    className="inline-flex items-center gap-1 text-[10px] font-medium text-green-400"
                    title={rc.addressed_at ? `Addressed at ${new Date(rc.addressed_at).toLocaleString()}` : "Addressed"}
                  >
                    <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                    </svg>
                    Addressed
                  </span>
                )}
                {rc.status === "pending" && (
                  <span className="text-[10px] font-medium text-text-muted">Pending</span>
                )}
                {rc.file_path && (
                  <span className="text-[10px] text-brand">
                    {rc.file_path}:{rc.line_start === rc.line_end ? rc.line_start : `${rc.line_start}-${rc.line_end}`}
                  </span>
                )}
                <span className="text-[10px] text-text-muted">{formatDate(rc.created_at)}</span>
              </div>
              <p className="text-[11px] text-text-secondary">{rc.comment}</p>
            </div>
          ))}
        </div>
      )}

      {reviewComments.length === 0 && !runDiff && (
        <p className="mt-3 rounded-lg border border-dashed border-border-strong px-3 py-6 text-center text-xs text-text-muted">
          No review comments yet. Submit feedback below to request changes.
        </p>
      )}
    </div>
  );
}
