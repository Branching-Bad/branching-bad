import { useRef, useEffect } from "react";

export function InlineCommentEditor({
  draftText,
  reviewMode,
  onDraftChange,
  onSave,
  onCancel,
}: {
  draftText: string;
  reviewMode: "instant" | "batch";
  onDraftChange: (text: string) => void;
  onSave: () => void;
  onCancel: () => void;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    ref.current?.focus();
  }, []);

  return (
    <div className="mx-2 my-1 rounded-lg border border-brand/40 bg-surface-200 p-2">
      <textarea
        ref={ref}
        value={draftText}
        onChange={(e) => onDraftChange(e.target.value)}
        onKeyDown={(e) => {
          if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
            e.preventDefault();
            onSave();
          }
          if (e.key === "Escape") {
            e.preventDefault();
            onCancel();
          }
        }}
        placeholder="Write your comment..."
        rows={2}
        className="w-full rounded-md border border-border-strong bg-surface-100 px-2 py-1 text-xs text-text-primary placeholder:text-text-muted focus:border-brand focus:outline-none"
      />
      <div className="mt-1 flex items-center justify-between">
        <span className="text-[10px] text-text-muted">Cmd+Enter to save, Esc to cancel</span>
        <div className="flex gap-1">
          <button
            onClick={onCancel}
            className="rounded-md border border-border-strong bg-surface-100 px-2 py-0.5 text-[11px] text-text-secondary hover:brightness-110"
          >
            Cancel
          </button>
          <button
            onClick={onSave}
            disabled={!draftText.trim()}
            className="rounded-md bg-brand px-2 py-0.5 text-[11px] font-medium text-white hover:brightness-110 disabled:opacity-50"
          >
            {reviewMode === "batch" ? "Add Comment" : "Send"}
          </button>
        </div>
      </div>
    </div>
  );
}
