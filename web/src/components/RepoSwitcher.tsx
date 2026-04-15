import { useEffect, useRef } from "react";
import type { Repo } from "../types";

export function RepoSwitcher({
  repos,
  selectedRepoId,
  setSelectedRepoId,
  onAddRepository,
  open,
  onOpenChange,
}: {
  repos: Repo[];
  selectedRepoId: string;
  setSelectedRepoId: (id: string) => void;
  onAddRepository: () => void;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const selectedRepo = repos.find((r) => r.id === selectedRepoId);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onOpenChange(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onOpenChange(false); };
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, onOpenChange]);

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => onOpenChange(!open)}
        className="group flex w-full items-center gap-2 rounded-[var(--radius-md)] border border-border-default bg-surface-200 px-3 py-2 text-left transition hover:bg-surface-300"
      >
        <div className="min-w-0 flex-1">
          <p className="truncate text-[13px] font-medium text-text-primary">
            {selectedRepo?.name ?? "No repository"}
          </p>
          {selectedRepo && (
            <p className="truncate text-[10px] text-text-muted">{selectedRepo.default_branch}</p>
          )}
        </div>
        <svg className="h-3 w-3 shrink-0 text-text-muted" viewBox="0 0 12 12" fill="none">
          <path d="M3 4.5L6 7.5L9 4.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {open && (
        <div className="absolute left-0 right-0 top-full z-50 mt-1 max-h-[320px] overflow-hidden rounded-[var(--radius-lg)] border border-border-default bg-surface-100 shadow-[var(--shadow-lg)]">
          <div className="max-h-[260px] overflow-y-auto py-1">
            {repos.map((r) => {
              const active = r.id === selectedRepoId;
              return (
                <button
                  key={r.id}
                  onClick={() => { setSelectedRepoId(r.id); onOpenChange(false); }}
                  className={`flex w-full items-center justify-between gap-2 px-3 py-2 text-left transition ${
                    active ? "bg-brand-tint text-text-primary" : "text-text-secondary hover:bg-surface-200 hover:text-text-primary"
                  }`}
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[12px] font-medium">{r.name}</p>
                    <p className="truncate text-[10px] text-text-muted">{r.default_branch}</p>
                  </div>
                  {active && (
                    <svg className="h-3 w-3 shrink-0 text-brand" viewBox="0 0 12 12" fill="none">
                      <path d="M2 6L5 9L10 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  )}
                </button>
              );
            })}
            {repos.length === 0 && (
              <p className="px-3 py-3 text-[11px] text-text-muted italic">No repositories yet.</p>
            )}
          </div>
          <div className="border-t border-border-default">
            <button
              onClick={() => { onAddRepository(); onOpenChange(false); }}
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-[12px] font-medium text-text-secondary transition hover:bg-surface-200 hover:text-text-primary"
            >
              <svg className="h-3 w-3" viewBox="0 0 12 12" fill="none">
                <path d="M6 2V10M2 6H10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
              Add Repository…
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
