import { useState } from "react";
import type { TaskMemory } from "../../hooks/useMemoryState";
import { IconX } from "../icons";
import { inputClass, btnSecondary } from "../shared";
import { ImportDialog } from "../ImportDialog";

export function MemoryPanel({
  selectedRepoId,
  memories,
  memoryTotal,
  memoryPage,
  memoryTotalPages,
  memoryLoading,
  memorySearchQuery,
  onMemorySearchChange,
  onLoadMemories,
  onDeleteMemory,
  onExportMemories,
  onImportMemories,
}: {
  selectedRepoId: string;
  memories: TaskMemory[];
  memoryTotal: number;
  memoryPage: number;
  memoryTotalPages: number;
  memoryLoading: boolean;
  memorySearchQuery: string;
  onMemorySearchChange: (q: string) => void;
  onLoadMemories: (repoId: string, query?: string, page?: number) => Promise<void>;
  onDeleteMemory: (id: string, repoId: string, query?: string, page?: number) => Promise<void>;
  onExportMemories?: (repoId: string) => void;
  onImportMemories?: (repoId: string, file: File, strategy: "skip" | "update") => Promise<{ created: number; updated: number; skipped: number }>;
}) {
  const [memoryImportOpen, setMemoryImportOpen] = useState(false);
  return (
    <div className="space-y-4">
      <div>
        <label className="mb-1.5 block text-xs font-semibold text-text-muted uppercase tracking-wider">Search Memories</label>
        <div className="flex items-center gap-2">
        <input
          type="text"
          value={memorySearchQuery}
          onChange={(e) => onMemorySearchChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void onLoadMemories(selectedRepoId, memorySearchQuery, 1);
          }}
          placeholder="Enter keywords..."
          className={`${inputClass} flex-1 !py-1.5 !text-xs`}
        />
        <button
          onClick={() => void onLoadMemories(selectedRepoId, memorySearchQuery, 1)}
          disabled={memoryLoading || !selectedRepoId}
          className="shrink-0 rounded-md bg-brand px-3 py-1.5 text-[11px] font-medium text-white transition hover:bg-brand/80 disabled:bg-surface-400 disabled:text-text-muted disabled:cursor-not-allowed"
        >
          {memoryLoading ? "Loading..." : "Search"}
        </button>
        </div>
      </div>

      {(onExportMemories || onImportMemories) && selectedRepoId && (
        <div className="flex gap-2">
          {onExportMemories && (
            <button
              onClick={() => onExportMemories(selectedRepoId)}
              disabled={memories.length === 0}
              className={`${btnSecondary} !px-3 !py-1.5 !text-[11px]`}
            >
              Export JSON
            </button>
          )}
          {onImportMemories && (
            <button
              onClick={() => setMemoryImportOpen(true)}
              className={`${btnSecondary} !px-3 !py-1.5 !text-[11px]`}
            >
              Import JSON
            </button>
          )}
        </div>
      )}

      {onImportMemories && (
        <ImportDialog
          open={memoryImportOpen}
          title="Import Memories"
          onClose={() => setMemoryImportOpen(false)}
          onImport={(file, strategy) => onImportMemories(selectedRepoId, file, strategy)}
        />
      )}

      {!selectedRepoId && (
        <p className="text-[11px] text-text-muted italic">Select a repository to view memories.</p>
      )}

      {selectedRepoId && memories.length === 0 && !memoryLoading && (
        <p className="text-[11px] text-text-muted italic">No memories found.</p>
      )}

      <div className="space-y-2">
        {memories.map((m) => (
          <div key={m.id} className="group rounded-lg border border-border-default bg-surface-200 px-3 py-2.5 space-y-1.5">
            <div className="flex items-start justify-between gap-2">
              <h5 className="text-xs font-medium text-text-primary leading-snug">{m.title}</h5>
              <button
                onClick={() => void onDeleteMemory(m.id, selectedRepoId, memorySearchQuery, memoryPage)}
                className="shrink-0 text-text-muted opacity-0 transition group-hover:opacity-100 hover:text-status-danger"
                title="Delete memory"
              >
                <IconX className="h-3 w-3" />
              </button>
            </div>
            <p className="text-[11px] text-text-secondary leading-relaxed whitespace-pre-wrap">{m.summary}</p>
            {m.files_changed.length > 0 && (
              <p className="text-[10px] text-text-muted">
                Files: {m.files_changed.slice(0, 5).join(", ")}
                {m.files_changed.length > 5 && ` (+${m.files_changed.length - 5} more)`}
              </p>
            )}
            <p className="text-[10px] text-text-muted">{new Date(m.created_at).toLocaleDateString()}</p>
          </div>
        ))}
      </div>

      {/* Pagination */}
      {memoryTotalPages > 1 && (
        <div className="flex items-center justify-between pt-2">
          <span className="text-[11px] text-text-muted">
            {memoryTotal} memories &middot; Page {memoryPage} of {memoryTotalPages}
          </span>
          <div className="flex gap-1.5">
            <button
              onClick={() => void onLoadMemories(selectedRepoId, memorySearchQuery, memoryPage - 1)}
              disabled={memoryPage <= 1 || memoryLoading}
              className="rounded-md bg-surface-300 px-2.5 py-1 text-[10px] font-medium text-text-muted hover:text-text-primary disabled:text-text-muted/40 disabled:cursor-not-allowed"
            >
              Prev
            </button>
            <button
              onClick={() => void onLoadMemories(selectedRepoId, memorySearchQuery, memoryPage + 1)}
              disabled={memoryPage >= memoryTotalPages || memoryLoading}
              className="rounded-md bg-surface-300 px-2.5 py-1 text-[10px] font-medium text-text-muted hover:text-text-primary disabled:text-text-muted/40 disabled:cursor-not-allowed"
            >
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
