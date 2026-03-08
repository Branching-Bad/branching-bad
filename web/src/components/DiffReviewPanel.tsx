import { useState } from "react";
import type { Task, ReviewComment, LineComment, ApplyToMainOptions, GitStatusInfo, AgentProfile } from "../types";
import { AgentProfileSelect } from "./AgentProfileSelect";
import { DiffViewer } from "./DiffViewer";
import { IconBookmark, IconExpand } from "./icons";
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
  onPinAsRule,
  onEditReviewComment,
  onDeleteReviewComment,
  onResendReviewComment,
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
  onPinAsRule?: (commentId: string) => void;
  onEditReviewComment?: (commentId: string, newText: string) => void;
  onDeleteReviewComment?: (commentId: string) => void;
  onResendReviewComment?: (commentId: string) => void;
}) {
  const [editingCommentId, setEditingCommentId] = useState<string | null>(null);
  const [editingText, setEditingText] = useState("");
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
            className="rounded-md bg-brand px-3 py-1.5 text-xs font-medium text-white transition hover:bg-brand/80 disabled:bg-surface-400 disabled:text-text-muted disabled:cursor-not-allowed"
          >
            Review Gonder ({batchLineComments.length + (reviewText.trim() ? 1 : 0)} comment)
          </button>
        ) : (
          <button
            onClick={onSubmitReview}
            disabled={busy || !reviewText.trim()}
            className="rounded-md bg-brand px-3 py-1.5 text-xs font-medium text-white transition hover:bg-brand/80 disabled:bg-surface-400 disabled:text-text-muted disabled:cursor-not-allowed"
          >
            Submit Feedback
          </button>
        )}
      </div>

      {/* Past review comments */}
      {reviewComments.length > 0 && (
        <div className="mt-3 space-y-2">
          <h5 className="text-[11px] font-medium text-text-secondary">Review History</h5>
          {reviewComments.map((rc) => {
            const isEditing = editingCommentId === rc.id;
            const canModify = rc.status !== "addressed";
            return (
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
                <span className="ml-auto flex items-center gap-1">
                  {onPinAsRule && (
                    <button onClick={() => onPinAsRule(rc.id)} className="rounded-md p-0.5 text-text-muted transition hover:text-brand" title="Save as repository rule">
                      <IconBookmark className="h-3 w-3" />
                    </button>
                  )}
                  {canModify && onResendReviewComment && (
                    <button onClick={() => onResendReviewComment(rc.id)} className="rounded-md p-0.5 text-text-muted transition hover:text-blue-400" title="Re-send">
                      <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
                    </button>
                  )}
                  {canModify && onEditReviewComment && (
                    <button onClick={() => { setEditingCommentId(rc.id); setEditingText(rc.comment); }} className="rounded-md p-0.5 text-text-muted transition hover:text-yellow-400" title="Edit">
                      <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" /></svg>
                    </button>
                  )}
                  {canModify && onDeleteReviewComment && (
                    <button onClick={() => onDeleteReviewComment(rc.id)} className="rounded-md p-0.5 text-text-muted transition hover:text-red-400" title="Delete">
                      <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                    </button>
                  )}
                </span>
              </div>
              {isEditing ? (
                <div className="mt-1 flex gap-1">
                  <textarea value={editingText} onChange={(e) => setEditingText(e.target.value)} className="flex-1 rounded border border-border-strong bg-surface-200 px-2 py-1 text-[11px] text-text-primary outline-none focus:border-brand" rows={2} />
                  <div className="flex flex-col gap-1">
                    <button onClick={() => { onEditReviewComment?.(rc.id, editingText); setEditingCommentId(null); }} disabled={!editingText.trim()} className="rounded bg-brand px-2 py-0.5 text-[10px] text-white hover:bg-brand/80 disabled:opacity-50">Save</button>
                    <button onClick={() => setEditingCommentId(null)} className="rounded bg-surface-300 px-2 py-0.5 text-[10px] text-text-muted hover:bg-surface-400">Cancel</button>
                  </div>
                </div>
              ) : (
                <p className="text-[11px] text-text-secondary">{rc.comment}</p>
              )}
            </div>
            );
          })}
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
