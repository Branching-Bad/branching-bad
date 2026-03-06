import { useState, useMemo, useCallback, useRef, useEffect } from "react";
import { parseDiff } from "react-diff-view";
import type { FileData } from "react-diff-view";
import type { Task, ReviewComment, LineComment, ApplyToMainOptions, GitStatusInfo, AgentProfile } from "../types";
import { AgentProfileSelect } from "./AgentProfileSelect";
import { DiffViewer } from "./DiffViewer";
import { MergeOptionsBar } from "./MergeOptionsBar";
import { IconBookmark, IconX } from "./icons";
import { formatDate } from "./shared";

type Selection = {
  filePath: string;
  lineStart: number;
  lineEnd: number;
  hunk: string;
  anchorKey: string;
};

type ViewType = "unified" | "split";

/* ---------- file tree helpers ---------- */

type TreeNode = {
  name: string;
  path: string; // full path
  children: TreeNode[];
  file?: FileData;
  additions: number;
  deletions: number;
  commentCount: number;
};

function filePath(file: FileData): string {
  return file.newPath || file.oldPath || "unknown";
}

function fileStats(file: FileData): { additions: number; deletions: number } {
  let additions = 0;
  let deletions = 0;
  for (const hunk of file.hunks) {
    for (const change of hunk.changes) {
      if (change.type === "insert") additions++;
      else if (change.type === "delete") deletions++;
    }
  }
  return { additions, deletions };
}

function buildTree(files: FileData[], batchComments: LineComment[]): TreeNode {
  const root: TreeNode = { name: "", path: "", children: [], additions: 0, deletions: 0, commentCount: 0 };

  for (const file of files) {
    const fp = filePath(file);
    const parts = fp.split("/");
    let current = root;
    for (let i = 0; i < parts.length; i++) {
      const partPath = parts.slice(0, i + 1).join("/");
      const isLast = i === parts.length - 1;
      let child = current.children.find((c) => c.path === partPath);
      if (!child) {
        const stats = isLast ? fileStats(file) : { additions: 0, deletions: 0 };
        const commentCount = isLast ? batchComments.filter((c) => c.filePath === fp).length : 0;
        child = {
          name: parts[i],
          path: partPath,
          children: [],
          file: isLast ? file : undefined,
          additions: stats.additions,
          deletions: stats.deletions,
          commentCount,
        };
        current.children.push(child);
      }
      if (isLast) {
        // update stats in case it was created as a folder earlier
        const stats = fileStats(file);
        child.file = file;
        child.additions = stats.additions;
        child.deletions = stats.deletions;
        child.commentCount = batchComments.filter((c) => c.filePath === fp).length;
      }
      current = child;
    }
  }

  // Collapse single-child folders
  const collapse = (node: TreeNode): TreeNode => {
    node.children = node.children.map(collapse);
    if (!node.file && node.children.length === 1 && !node.children[0].file) {
      const child = node.children[0];
      return { ...child, name: node.name ? `${node.name}/${child.name}` : child.name };
    }
    return node;
  };

  return collapse(root);
}

/* ---------- FileTree component ---------- */

function FileTree({
  node,
  depth,
  activeFile,
  onSelect,
}: {
  node: TreeNode;
  depth: number;
  activeFile: string;
  onSelect: (path: string) => void;
}) {
  const [expanded, setExpanded] = useState(true);

  if (node.file) {
    const isActive = activeFile === node.path;
    return (
      <button
        onClick={() => onSelect(node.path)}
        title={node.path}
        className={`flex w-full items-center gap-1 rounded-md px-1.5 py-1 text-left text-[11px] transition ${
          isActive
            ? "bg-brand/15 text-brand font-medium"
            : "text-text-secondary hover:bg-surface-300 hover:text-text-primary"
        }`}
        style={{ paddingLeft: `${depth * 12 + 6}px` }}
      >
        <span className="truncate flex-1">{node.name}</span>
        {node.commentCount > 0 && (
          <span className="shrink-0 rounded-full bg-brand/20 px-1 text-[9px] font-medium text-brand">
            {node.commentCount}
          </span>
        )}
        <span className="shrink-0 flex items-center gap-1 text-[9px]">
          {node.additions > 0 && <span className="text-green-400">+{node.additions}</span>}
          {node.deletions > 0 && <span className="text-red-400">-{node.deletions}</span>}
        </span>
      </button>
    );
  }

  // Folder node
  return (
    <div>
      <button
        onClick={() => setExpanded(!expanded)}
        title={node.path}
        className="flex w-full items-center gap-1 rounded-md px-1.5 py-1 text-left text-[11px] text-text-muted hover:bg-surface-300 hover:text-text-secondary transition"
        style={{ paddingLeft: `${depth * 12 + 6}px` }}
      >
        <svg
          className={`h-2.5 w-2.5 shrink-0 transition-transform ${expanded ? "rotate-90" : ""}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
        </svg>
        <span className="truncate">{node.name}</span>
      </button>
      {expanded && node.children.map((child) => (
        <FileTree key={child.path} node={child} depth={depth + 1} activeFile={activeFile} onSelect={onSelect} />
      ))}
    </div>
  );
}

/* ---------- DiffReviewModal ---------- */

export function DiffReviewModal({
  open,
  onClose,
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
  agentProfiles,
  reviewProfileId,
  onReviewProfileChange,
  onPinAsRule,
}: {
  open: boolean;
  onClose: () => void;
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
  agentProfiles?: AgentProfile[];
  reviewProfileId?: string;
  onReviewProfileChange?: (v: string) => void;
  onPinAsRule?: (commentId: string) => void;
}) {
  const files = useMemo(() => {
    if (!runDiff) return [];
    try { return parseDiff(runDiff); } catch { return []; }
  }, [runDiff]);

  const tree = useMemo(() => buildTree(files, batchLineComments), [files, batchLineComments]);

  const [activeFile, setActiveFile] = useState("");
  const [viewType, setViewType] = useState<ViewType>("unified");

  // Resizable file tree width
  const [treeWidth, setTreeWidth] = useState(220);
  const treeWidthRef = useRef(220);

  const rightPanelRef = useRef<HTMLDivElement>(null);

  const [focusedFile, setFocusedFile] = useState("");

  const scrollToFile = useCallback((path: string) => {
    setActiveFile(path);
    setFocusedFile(path);
    setTimeout(() => {
      if (!rightPanelRef.current) return;
      const el = rightPanelRef.current.querySelector(`[data-file-path="${CSS.escape(path)}"]`);
      if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 50);
  }, []);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative flex flex-col overflow-hidden rounded-2xl border border-border-default bg-surface-100 shadow-2xl"
        style={{ width: "96vw", height: "92vh", maxWidth: "96vw", maxHeight: "92vh" }}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border-default px-4 py-2.5">
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-text-primary">
              Review — {selectedTask.jira_issue_key}{" "}
              <span className="font-normal text-text-secondary">{selectedTask.title}</span>
            </h2>
          </div>
          <div className="flex items-center gap-2">
            {/* View type toggle */}
            <div className="flex items-center gap-0.5 rounded-lg border border-border-strong bg-surface-300 p-0.5">
              <button
                onClick={() => setViewType("unified")}
                className={`rounded-md px-2 py-0.5 text-[10px] font-medium transition ${
                  viewType === "unified"
                    ? "bg-surface-100 text-text-primary shadow-sm"
                    : "text-text-muted hover:text-text-secondary"
                }`}
                title="Unified view"
              >
                Unified
              </button>
              <button
                onClick={() => setViewType("split")}
                className={`rounded-md px-2 py-0.5 text-[10px] font-medium transition ${
                  viewType === "split"
                    ? "bg-surface-100 text-text-primary shadow-sm"
                    : "text-text-muted hover:text-text-secondary"
                }`}
                title="Side-by-side view"
              >
                Split
              </button>
            </div>
            <button
              onClick={onClose}
              className="rounded-md p-1 text-text-muted transition hover:bg-surface-300 hover:text-text-primary"
            >
              <IconX className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Body — two columns with resizable splitter */}
        <div className="flex flex-1 overflow-hidden">
          {/* Left: file tree (resizable) */}
          <div
            className="shrink-0 overflow-y-auto bg-surface-200 p-2"
            style={{ width: `${treeWidth}px` }}
          >
            <h3 className="mb-1.5 px-1.5 text-[10px] font-semibold uppercase tracking-wider text-text-muted">Files</h3>
            {tree.children.length === 0 ? (
              <p className="px-1.5 py-3 text-[11px] text-text-muted">No files in diff</p>
            ) : (
              tree.children.map((child) => (
                <FileTree key={child.path} node={child} depth={0} activeFile={activeFile} onSelect={scrollToFile} />
              ))
            )}
          </div>

          {/* Resize handle between tree and diff */}
          <TreeResizeHandle
            onResize={(newWidth) => {
              setTreeWidth(newWidth);
              treeWidthRef.current = newWidth;
            }}
            currentWidth={treeWidth}
          />

          {/* Right: diff + review controls */}
          <div ref={rightPanelRef} className="flex-1 overflow-y-auto px-[2%] py-3 space-y-3">
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

            {/* Mode toggle */}
            <div className="flex items-center gap-1 rounded-lg border border-border-strong bg-surface-300 p-0.5">
              <button
                onClick={() => setReviewMode("batch")}
                className={`flex-1 rounded-md px-2.5 py-1 text-[11px] font-medium transition ${
                  reviewMode === "batch"
                    ? "bg-surface-100 text-text-primary shadow-sm"
                    : "text-text-muted hover:text-text-secondary"
                }`}
              >
                Batch Review
              </button>
              <button
                onClick={() => setReviewMode("instant")}
                className={`flex-1 rounded-md px-2.5 py-1 text-[11px] font-medium transition ${
                  reviewMode === "instant"
                    ? "bg-surface-100 text-text-primary shadow-sm"
                    : "text-text-muted hover:text-text-secondary"
                }`}
              >
                Instant
              </button>
            </div>

            {/* Conflict display */}
            {applyConflicts.length > 0 && (
              <div className="rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2">
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

            {/* Diff viewer */}
            {runDiffLoading ? (
              <div className="flex items-center justify-center rounded-lg border border-dashed border-border-strong py-8">
                <span className="text-xs text-text-muted animate-pulse">Loading diff...</span>
              </div>
            ) : runDiff ? (
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
                focusedFile={focusedFile}
                viewType={viewType}
              />
            ) : null}

            {/* Batch comments list */}
            {reviewMode === "batch" && batchLineComments.length > 0 && (
              <div className="space-y-1">
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
            <div className="flex items-center gap-2">
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
              <div className="space-y-2">
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
                      {onPinAsRule && (
                        <button
                          onClick={() => onPinAsRule(rc.id)}
                          className="ml-auto rounded-md p-0.5 text-text-muted transition hover:text-brand"
                          title="Save as repository rule"
                        >
                          <IconBookmark className="h-3 w-3" />
                        </button>
                      )}
                    </div>
                    <p className="text-[11px] text-text-secondary">{rc.comment}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ---------- Tree resize handle (tracks base width) ---------- */

function TreeResizeHandle({
  onResize,
  currentWidth,
}: {
  onResize: (newWidth: number) => void;
  currentWidth: number;
}) {
  const baseRef = useRef(currentWidth);

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      baseRef.current = currentWidth;
      const startX = e.clientX;

      const onMouseMove = (ev: MouseEvent) => {
        const delta = ev.clientX - startX;
        const newWidth = Math.max(120, Math.min(500, baseRef.current + delta));
        onResize(newWidth);
      };

      const onMouseUp = () => {
        document.removeEventListener("mousemove", onMouseMove);
        document.removeEventListener("mouseup", onMouseUp);
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
      };

      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
      document.addEventListener("mousemove", onMouseMove);
      document.addEventListener("mouseup", onMouseUp);
    },
    [onResize, currentWidth],
  );

  return (
    <div
      onMouseDown={handleMouseDown}
      className="shrink-0 w-[3px] cursor-col-resize bg-border-default transition hover:bg-brand/40 hover:w-[4px]"
    />
  );
}
