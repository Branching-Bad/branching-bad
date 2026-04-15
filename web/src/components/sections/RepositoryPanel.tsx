import { useCallback, useEffect, useState } from "react";
import type { FormEvent } from "react";
import type { Repo } from "../../types";
import { api } from "../../api";
import { FolderPicker } from "../FolderPicker";
import { TaskDefaultsSection } from "../TaskDefaultsSection";
import { inputClass, selectClass, btnPrimary, btnSecondary } from "../shared";

function BuildCommandSection({ repo, onSave }: { repo: Repo; onSave: (cmd: string | null) => void }) {
  const [cmd, setCmd] = useState(repo.build_command ?? "");
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    setCmd(repo.build_command ?? "");
    setSaved(false);
  }, [repo.id, repo.build_command]);

  return (
    <div>
      <label className="mb-1.5 block text-xs font-semibold text-text-muted uppercase tracking-wider">
        Build Command
      </label>
      <div className="flex gap-2">
        <input
          className={inputClass + " flex-1 font-mono"}
          value={cmd}
          onChange={(e) => { setCmd(e.target.value); setSaved(false); }}
          placeholder="e.g. npm run build, dotnet build, go build ./..."
        />
        <button
          onClick={() => { onSave(cmd.trim() || null); setSaved(true); }}
          className={btnSecondary + " shrink-0"}
        >
          {saved ? "Saved" : "Save"}
        </button>
      </div>
      <p className="mt-1.5 text-[11px] text-text-muted">
        Runs after each agent completion to verify the build. Leave empty to skip.
      </p>
    </div>
  );
}

export function RepositoryPanel({
  repos,
  selectedRepoId,
  setSelectedRepoId,
  busy,
  onRepoSubmit,
  repoPath,
  setRepoPath,
  repoName,
  setRepoName,
  onReposChange,
}: {
  repos: Repo[];
  selectedRepoId: string;
  setSelectedRepoId: (v: string) => void;
  busy: boolean;
  onRepoSubmit: (e: FormEvent) => void;
  repoPath: string;
  setRepoPath: (v: string) => void;
  repoName: string;
  setRepoName: (v: string) => void;
  onReposChange?: () => void;
}) {
  const [branches, setBranches] = useState<string[]>([]);
  const selectedRepo = repos.find((r) => r.id === selectedRepoId);

  useEffect(() => {
    if (!selectedRepoId) { setBranches([]); return; }
    api<{ branches: string[]; default: string }>(`/api/repos/${encodeURIComponent(selectedRepoId)}/branches`)
      .then((res) => setBranches(res.branches))
      .catch(() => setBranches([]));
  }, [selectedRepoId]);

  const handleDefaultBranchChange = useCallback(async (branch: string) => {
    if (!selectedRepoId || !branch) return;
    try {
      await api(`/api/repos/${encodeURIComponent(selectedRepoId)}`, {
        method: "PATCH",
        body: JSON.stringify({ defaultBranch: branch }),
      });
      onReposChange?.();
    } catch { /* silent */ }
  }, [selectedRepoId, onReposChange]);

  const handleBuildCommandSave = useCallback(async (cmd: string | null) => {
    if (!selectedRepoId) return;
    try {
      await api(`/api/repos/${encodeURIComponent(selectedRepoId)}`, {
        method: "PATCH",
        body: JSON.stringify({ buildCommand: cmd }),
      });
      onReposChange?.();
    } catch { /* silent */ }
  }, [selectedRepoId, onReposChange]);

  return (
    <div className="space-y-5">
      <div>
        <label className="mb-1.5 block text-xs font-semibold text-text-muted uppercase tracking-wider">Active Repository</label>
        <select className={selectClass} value={selectedRepoId} onChange={(e) => setSelectedRepoId(e.target.value)}>
          <option value="">Select repo</option>
          {repos.map((repo) => <option key={repo.id} value={repo.id}>{repo.name}</option>)}
        </select>
      </div>
      {selectedRepo && (
        <div>
          <label className="mb-1.5 block text-xs font-semibold text-text-muted uppercase tracking-wider">Default Branch</label>
          <select
            className={selectClass}
            value={selectedRepo.default_branch}
            onChange={(e) => void handleDefaultBranchChange(e.target.value)}
          >
            {branches.length > 0 ? branches.map((b) => (
              <option key={b} value={b}>{b}</option>
            )) : (
              <option value={selectedRepo.default_branch}>{selectedRepo.default_branch}</option>
            )}
          </select>
          <p className="mt-1.5 text-[11px] text-text-muted">
            Base branch for merging changes (currently: {selectedRepo.default_branch})
          </p>
        </div>
      )}
      {selectedRepo && (
        <BuildCommandSection
          repo={selectedRepo}
          onSave={(cmd) => void handleBuildCommandSave(cmd)}
        />
      )}
      {selectedRepo && (
        <TaskDefaultsSection repoId={selectedRepo.id} />
      )}
      <div className="rounded-xl border border-border-default bg-surface-200 p-5">
        <h3 className="mb-3 text-sm font-medium text-text-secondary">Add New Repository</h3>
        <form onSubmit={onRepoSubmit} className="space-y-3">
          <div>
            <label className="mb-1.5 block text-xs text-text-muted">Folder</label>
            <FolderPicker value={repoPath} onChange={setRepoPath} />
          </div>
          <div>
            <label className="mb-1.5 block text-xs text-text-muted">Label</label>
            <input className={inputClass} placeholder="e.g. My Project (optional)" value={repoName} onChange={(e) => setRepoName(e.target.value)} />
          </div>
          <button type="submit" disabled={busy || !repoPath} className={btnPrimary}>Save Repository</button>
        </form>
      </div>
    </div>
  );
}
