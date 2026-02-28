import { useState, useCallback } from "react";
import { api } from "../api";
import { IconFolder, IconChevronUp, IconX } from "./icons";
import { btnPrimary } from "./shared";

type FsDir = { name: string; path: string; isGit: boolean };
type FsListResponse = { path: string; parent: string | null; dirs: FsDir[] };

export function FolderPicker({ value, onChange }: { value: string; onChange: (path: string) => void }) {
  const [open, setOpen] = useState(false);
  const [currentPath, setCurrentPath] = useState("");
  const [parentPath, setParentPath] = useState<string | null>(null);
  const [dirs, setDirs] = useState<FsDir[]>([]);
  const [loading, setLoading] = useState(false);
  const [fsError, setFsError] = useState("");

  const loadDir = useCallback(async (path?: string) => {
    setLoading(true);
    setFsError("");
    try {
      const qs = path ? `?path=${encodeURIComponent(path)}` : "";
      const res = await api<FsListResponse>(`/api/fs/list${qs}`);
      setCurrentPath(res.path);
      setParentPath(res.parent);
      setDirs(res.dirs);
    } catch (e) {
      setFsError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  const handleOpen = useCallback(() => {
    setOpen(true);
    void loadDir(value || undefined);
  }, [value, loadDir]);

  const handleSelect = useCallback((path: string) => {
    onChange(path);
    setOpen(false);
  }, [onChange]);

  return (
    <>
      <button
        type="button"
        onClick={handleOpen}
        className="w-full rounded-md border border-border-strong bg-surface-300 px-3 py-2 text-left text-sm transition hover:border-brand focus:border-brand focus:outline-none"
      >
        {value ? (
          <span className="flex items-center gap-2">
            <IconFolder className="h-4 w-4 shrink-0 text-brand" />
            <span className="truncate text-text-primary">{value}</span>
          </span>
        ) : (
          <span className="flex items-center gap-2 text-text-muted">
            <IconFolder className="h-4 w-4 shrink-0" />
            Choose folder…
          </span>
        )}
      </button>

      {open && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center">
          <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={() => setOpen(false)} />
          <div className="relative w-full max-w-[480px] rounded-2xl border border-border-default bg-surface-100 shadow-2xl">
            {/* Header */}
            <div className="flex items-center justify-between border-b border-border-default px-5 py-3">
              <h3 className="text-sm font-medium text-text-primary">Select Folder</h3>
              <button onClick={() => setOpen(false)} className="rounded-md p-1 text-text-muted transition hover:bg-surface-300 hover:text-text-primary">
                <IconX className="h-4 w-4" />
              </button>
            </div>

            {/* Breadcrumb */}
            <div className="flex items-center gap-1 border-b border-border-default px-5 py-2">
              <code className="truncate text-xs text-text-secondary">{currentPath}</code>
            </div>

            {/* Error */}
            {fsError && (
              <div className="mx-5 mt-3 rounded-lg border border-error-border bg-error-bg px-3 py-2 text-xs text-error-text">
                {fsError}
              </div>
            )}

            {/* Dir listing */}
            <div className="max-h-[320px] overflow-y-auto px-2 py-2">
              {/* Go up */}
              {parentPath && (
                <button
                  onClick={() => void loadDir(parentPath)}
                  className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm text-text-secondary transition hover:bg-surface-300"
                >
                  <IconChevronUp className="h-4 w-4 shrink-0 text-text-muted" />
                  <span>..</span>
                </button>
              )}

              {loading ? (
                <div className="py-8 text-center text-xs text-text-muted">Loading…</div>
              ) : dirs.length === 0 ? (
                <div className="py-8 text-center text-xs text-text-muted">No subdirectories</div>
              ) : (
                dirs.map((dir) => (
                  <div key={dir.path} className="group flex items-center rounded-lg transition hover:bg-surface-300">
                    <button
                      onClick={() => void loadDir(dir.path)}
                      className="flex min-w-0 flex-1 items-center gap-2.5 px-3 py-2 text-left"
                    >
                      <IconFolder className={`h-4 w-4 shrink-0 ${dir.isGit ? "text-brand" : "text-text-muted"}`} />
                      <span className="truncate text-sm text-text-primary">{dir.name}</span>
                      {dir.isGit && (
                        <span className="ml-auto shrink-0 rounded-full border border-brand/30 bg-brand-tint px-1.5 py-0.5 text-[10px] text-brand">
                          git
                        </span>
                      )}
                    </button>
                    <button
                      onClick={() => handleSelect(dir.path)}
                      className="mr-2 shrink-0 rounded-md border border-brand-glow bg-brand-dark px-2 py-1 text-[11px] font-medium text-brand opacity-0 transition group-hover:opacity-100"
                    >
                      Select
                    </button>
                  </div>
                ))
              )}
            </div>

            {/* Footer: select current dir */}
            <div className="flex items-center justify-between border-t border-border-default px-5 py-3">
              <span className="truncate text-xs text-text-muted">{currentPath}</span>
              <button
                onClick={() => handleSelect(currentPath)}
                className={`${btnPrimary} !py-1.5 !px-3 text-xs`}
              >
                Select This Folder
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
