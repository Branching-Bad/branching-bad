import { useState, useMemo, useCallback, useEffect, type ReactNode } from "react";
import { Diff, Hunk, parseDiff, getChangeKey, tokenize } from "react-diff-view";
import type { ChangeData, FileData, HunkData } from "react-diff-view";
import { refractor } from "refractor";
import type { LineComment } from "../types";
import { InlineCommentEditor } from "./InlineCommentEditor";
import "react-diff-view/style/index.css";

type Selection = {
  filePath: string;
  lineStart: number;
  lineEnd: number;
  hunk: string;
  anchorKey: string;
};

type ViewType = "unified" | "split";

/* ---------- language detection ---------- */

const EXT_TO_LANG: Record<string, string> = {
  ts: "typescript", tsx: "tsx", js: "javascript", jsx: "jsx",
  py: "python", rb: "ruby", rs: "rust", go: "go",
  java: "java", kt: "kotlin", cs: "csharp", cpp: "cpp", c: "c", h: "c",
  css: "css", scss: "css", less: "css",
  html: "html", htm: "html", vue: "html", svelte: "html",
  json: "json", yaml: "yaml", yml: "yaml", toml: "toml",
  md: "markdown", mdx: "markdown",
  sql: "sql", sh: "bash", bash: "bash", zsh: "bash",
  xml: "xml", svg: "xml",
  php: "php", swift: "swift", dart: "dart",
  dockerfile: "docker", makefile: "makefile",
  graphql: "graphql", gql: "graphql",
  elixir: "elixir", ex: "elixir", exs: "elixir",
};

function detectLanguage(fp: string): string | undefined {
  if (!refractor?.registered) return undefined;
  const name = fp.split("/").pop()?.toLowerCase() ?? "";
  if (name === "dockerfile") return "docker";
  if (name === "makefile") return "makefile";
  const ext = name.split(".").pop() ?? "";
  const lang = EXT_TO_LANG[ext];
  if (!lang) return undefined;
  return refractor.registered(lang) ? lang : undefined;
}

export function DiffViewer({
  diffText,
  batchComments,
  selection,
  draftText,
  reviewMode,
  onLineSelect,
  onDraftChange,
  onCommentSave,
  onCommentCancel,
  focusedFile,
  viewType = "unified",
}: {
  diffText: string;
  batchComments: LineComment[];
  selection: Selection | null;
  draftText: string;
  reviewMode: "instant" | "batch";
  onLineSelect: (filePath: string, lineStart: number, lineEnd: number, hunk: string, anchorKey: string) => void;
  onDraftChange: (text: string) => void;
  onCommentSave: () => void;
  onCommentCancel: () => void;
  focusedFile?: string;
  viewType?: ViewType;
}) {
  const files = useMemo(() => {
    if (!diffText) return [];
    try {
      return parseDiff(diffText);
    } catch {
      return [];
    }
  }, [diffText]);

  const [expandedFiles, setExpandedFiles] = useState<Set<string>>(new Set());

  // Auto-expand focused file from external navigation (e.g. file tree click)
  useEffect(() => {
    if (focusedFile && !expandedFiles.has(focusedFile)) {
      setExpandedFiles((prev) => new Set(prev).add(focusedFile));
    }
  }, [focusedFile]); // eslint-disable-line react-hooks/exhaustive-deps

  const toggleFile = useCallback((path: string) => {
    setExpandedFiles((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }, []);

  if (files.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border-strong px-3 py-6 text-center text-xs text-text-muted">
        No diff available for this run.
      </div>
    );
  }

  return (
    <div className="space-y-1">
      {files.map((file) => (
        <FileCard
          key={filePath(file)}
          file={file}
          expanded={expandedFiles.has(filePath(file))}
          onToggle={() => toggleFile(filePath(file))}
          selection={selection}
          draftText={draftText}
          reviewMode={reviewMode}
          batchComments={batchComments}
          onLineSelect={onLineSelect}
          onDraftChange={onDraftChange}
          onCommentSave={onCommentSave}
          onCommentCancel={onCommentCancel}
          viewType={viewType}
        />
      ))}
    </div>
  );
}

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

function FileCard({
  file,
  expanded,
  onToggle,
  selection,
  draftText,
  reviewMode,
  batchComments,
  onLineSelect,
  onDraftChange,
  onCommentSave,
  onCommentCancel,
  viewType,
}: {
  file: FileData;
  expanded: boolean;
  onToggle: () => void;
  selection: Selection | null;
  draftText: string;
  reviewMode: "instant" | "batch";
  batchComments: LineComment[];
  onLineSelect: (filePath: string, lineStart: number, lineEnd: number, hunk: string, anchorKey: string) => void;
  onDraftChange: (text: string) => void;
  onCommentSave: () => void;
  onCommentCancel: () => void;
  viewType: ViewType;
}) {
  const fp = filePath(file);
  const stats = fileStats(file);
  const [pendingStart, setPendingStart] = useState<{ line: number; key: string } | null>(null);

  // Count batch comments for this file
  const fileCommentCount = batchComments.filter((c) => c.filePath === fp).length;

  // Syntax highlighting tokens
  const tokens = useMemo(() => {
    const lang = detectLanguage(fp);
    if (!lang || file.hunks.length === 0) return undefined;
    try {
      const result = tokenize(file.hunks, {
        highlight: true,
        refractor,
        language: lang,
      });
      // Validate structure before passing to Diff
      if (!result || !Array.isArray(result.old) || !Array.isArray(result.new)) return undefined;
      return result;
    } catch {
      return undefined;
    }
  }, [file.hunks, fp]);

  // Build widgets for inline comment editor
  const widgets: Record<string, ReactNode> = {};
  if (selection && selection.filePath === fp) {
    widgets[selection.anchorKey] = (
      <InlineCommentEditor
        draftText={draftText}
        reviewMode={reviewMode}
        onDraftChange={onDraftChange}
        onSave={onCommentSave}
        onCancel={onCommentCancel}
      />
    );
  }

  // Build selected changes set for highlighting
  const selectedChanges: string[] = [];
  if (selection && selection.filePath === fp) {
    for (const hunk of file.hunks) {
      for (const change of hunk.changes) {
        const ln = getLineNumber(change);
        if (ln !== null && ln >= selection.lineStart && ln <= selection.lineEnd) {
          selectedChanges.push(getChangeKey(change));
        }
      }
    }
  }

  // Mark batch comment lines with a highlight via generateLineClassName
  const batchLineSet = useMemo(() => {
    const set = new Set<number>();
    for (const c of batchComments) {
      if (c.filePath === fp) {
        for (let l = c.lineStart; l <= c.lineEnd; l++) set.add(l);
      }
    }
    return set;
  }, [batchComments, fp]);

  const handleGutterClick = useCallback(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (args: { change: ChangeData | null }, e: any) => {
      const { change } = args;
      if (!change) return;
      const lineNum = getLineNumber(change);
      if (lineNum === null) return;
      const key = getChangeKey(change);

      if (e?.shiftKey && pendingStart) {
        // Range selection
        const start = Math.min(pendingStart.line, lineNum);
        const end = Math.max(pendingStart.line, lineNum);
        const hunkText = extractHunkText(file.hunks, start, end);
        onLineSelect(fp, start, end, hunkText, key);
        setPendingStart(null);
      } else {
        // Single click — start selection
        setPendingStart({ line: lineNum, key });
        const hunkText = extractHunkText(file.hunks, lineNum, lineNum);
        onLineSelect(fp, lineNum, lineNum, hunkText, key);
      }
    },
    [fp, file.hunks, onLineSelect, pendingStart],
  );

  return (
    <div className="rounded-lg border border-border-strong bg-surface-100 overflow-hidden" data-file-path={fp}>
      <button
        onClick={onToggle}
        className="flex w-full items-center justify-between px-3 py-2 text-left hover:bg-surface-200 transition"
      >
        <div className="flex items-center gap-2 min-w-0">
          <svg
            className={`h-3 w-3 shrink-0 text-text-muted transition-transform ${expanded ? "rotate-90" : ""}`}
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
          </svg>
          <span className="truncate text-xs font-medium text-text-primary">{fp}</span>
          {fileCommentCount > 0 && (
            <span className="shrink-0 rounded-full bg-brand/20 px-1.5 text-[10px] font-medium text-brand">
              {fileCommentCount}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0 text-[10px]">
          {stats.additions > 0 && <span className="text-green-400">+{stats.additions}</span>}
          {stats.deletions > 0 && <span className="text-red-400">-{stats.deletions}</span>}
        </div>
      </button>
      {expanded && (
        <div className="diff-viewer-content overflow-x-auto border-t border-border-strong text-[11px]">
          <Diff
            viewType={viewType}
            diffType={file.type as "add" | "delete" | "modify" | "rename" | "copy"}
            hunks={file.hunks}
            widgets={widgets}
            selectedChanges={selectedChanges}
            tokens={tokens}
            gutterEvents={{ onClick: handleGutterClick }}
            generateLineClassName={({ changes }) => {
              for (const c of changes) {
                if (!c) continue;
                const ln = getLineNumber(c);
                if (ln !== null && batchLineSet.has(ln)) {
                  return "diff-batch-commented";
                }
              }
              return undefined;
            }}
          >
            {(hunks: HunkData[]) => hunks.map((hunk) => <Hunk key={hunk.content} hunk={hunk} />)}
          </Diff>
        </div>
      )}
    </div>
  );
}

function getLineNumber(change: ChangeData | null | undefined): number | null {
  if (!change) return null;
  if (change.type === "normal") return change.newLineNumber;
  if (change.type === "insert") return change.lineNumber;
  if (change.type === "delete") return change.lineNumber;
  return null;
}

function extractHunkText(hunks: HunkData[], start: number, end: number): string {
  const lines: string[] = [];
  for (const hunk of hunks) {
    for (const change of hunk.changes) {
      const ln = getLineNumber(change);
      if (ln !== null && ln >= start && ln <= end) {
        lines.push(change.content);
      }
    }
  }
  return lines.join("\n");
}
