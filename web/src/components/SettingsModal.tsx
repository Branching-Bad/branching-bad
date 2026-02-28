import { useState } from "react";
import type { FormEvent } from "react";
import type { Repo, AgentProfile, ProviderMeta } from "../types";
import { IconX, IconRefresh } from "./icons";
import { inputClass, selectClass, btnPrimary, btnSecondary } from "./shared";
import { FolderPicker } from "./FolderPicker";
import { getAllProviderUIs } from "../providers/registry";

export function SettingsModal({
  open, onClose, repos, agentProfiles, providerMetas,
  selectedRepoId, setSelectedRepoId, selectedProfileId, setSelectedProfileId,
  selectedProfile, busy, setBusy, error: extError, info: extInfo,
  setError, setInfo,
  onRepoSubmit, discoverAgents, saveAgentSelection,
  repoPath, setRepoPath, repoName, setRepoName,
  onBootstrapRefresh,
}: {
  open: boolean; onClose: () => void;
  repos: Repo[]; agentProfiles: AgentProfile[];
  providerMetas: ProviderMeta[];
  selectedRepoId: string; setSelectedRepoId: (v: string) => void;
  selectedProfileId: string; setSelectedProfileId: (v: string) => void;
  selectedProfile: AgentProfile | null;
  busy: boolean; setBusy: (v: boolean) => void;
  error: string; info: string;
  setError: (v: string) => void; setInfo: (v: string) => void;
  onRepoSubmit: (e: FormEvent) => void;
  discoverAgents: () => void;
  saveAgentSelection: () => void;
  repoPath: string; setRepoPath: (v: string) => void;
  repoName: string; setRepoName: (v: string) => void;
  onBootstrapRefresh: () => void;
}) {
  const [tab, setTab] = useState("repo");

  if (!open) return null;

  // Build tabs: Repo + registered provider settings + Agent
  const providerTabs = getAllProviderUIs()
    .filter(([, ui]) => ui.settingsTab)
    .map(([id, ui]) => {
      const meta = providerMetas.find((m) => m.id === id);
      return { key: id, label: meta?.display_name ?? id, Tab: ui.settingsTab! };
    });

  const tabs: { key: string; label: string }[] = [
    { key: "repo", label: "Repository" },
    ...providerTabs.map((p) => ({ key: p.key, label: p.label })),
    { key: "agent", label: "AI Agent" },
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-[560px] rounded-2xl border border-border-default bg-surface-100 shadow-2xl">
        <div className="flex items-center justify-between border-b border-border-default px-6 py-4">
          <h2 className="text-base font-medium text-text-primary">Settings</h2>
          <button onClick={onClose} className="rounded-md p-1 text-text-muted transition hover:bg-surface-300 hover:text-text-primary">
            <IconX className="h-5 w-5" />
          </button>
        </div>
        <div className="flex border-b border-border-default px-6">
          {tabs.map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`relative px-4 py-3 text-sm font-medium transition ${tab === t.key ? "text-brand" : "text-text-muted hover:text-text-secondary"}`}
            >
              {t.label}
              {tab === t.key && <span className="absolute bottom-0 left-0 right-0 h-[2px] bg-brand" />}
            </button>
          ))}
        </div>
        <div className="px-6 pt-4">
          {extError && <div className="mb-3 rounded-lg border border-error-border bg-error-bg px-3 py-2 text-sm text-error-text">{extError}</div>}
          {extInfo && <div className="mb-3 rounded-lg border border-info-border bg-info-bg px-3 py-2 text-sm text-info-text">{extInfo}</div>}
        </div>
        <div className="max-h-[420px] overflow-y-auto px-6 pb-6">
          {tab === "repo" && (
            <div className="space-y-4">
              <div>
                <label className="mb-1.5 block text-xs font-medium text-text-muted uppercase tracking-wide">Active Repository</label>
                <select className={selectClass} value={selectedRepoId} onChange={(e) => setSelectedRepoId(e.target.value)}>
                  <option value="">Select repo</option>
                  {repos.map((repo) => <option key={repo.id} value={repo.id}>{repo.name}</option>)}
                </select>
              </div>
              <div className="rounded-xl border border-border-default bg-surface-200 p-4">
                <h3 className="mb-3 text-sm font-medium text-text-secondary">Add New Repository</h3>
                <form onSubmit={onRepoSubmit} className="space-y-3">
                  <div>
                    <label className="mb-1.5 block text-xs text-text-muted">Folder</label>
                    <FolderPicker value={repoPath} onChange={setRepoPath} />
                  </div>
                  <input className={inputClass} placeholder="Label (optional)" value={repoName} onChange={(e) => setRepoName(e.target.value)} />
                  <button type="submit" disabled={busy || !repoPath} className={btnPrimary}>Save Repository</button>
                </form>
              </div>
            </div>
          )}

          {/* Provider settings tabs - rendered from registry */}
          {providerTabs.map(({ key, Tab }) =>
            tab === key ? (
              <Tab
                key={key}
                selectedRepoId={selectedRepoId}
                busy={busy}
                onBusyChange={setBusy}
                onError={setError}
                onInfo={setInfo}
                onBootstrapRefresh={onBootstrapRefresh}
              />
            ) : null
          )}

          {tab === "agent" && (
            <div className="space-y-4">
              <div>
                <label className="mb-1.5 block text-xs font-medium text-text-muted uppercase tracking-wide">Agent / Model</label>
                <select className={selectClass} value={selectedProfileId} onChange={(e) => setSelectedProfileId(e.target.value)}>
                  <option value="">Select agent/model</option>
                  {agentProfiles.map((p) => (
                    <option key={p.id} value={p.id}>{`${p.agent_name} \u00B7 ${p.model}`}</option>
                  ))}
                </select>
                {selectedProfile && (
                  <p className="mt-2 text-xs text-text-muted">
                    {selectedProfile.provider} &middot; <code className="text-text-secondary">{selectedProfile.command}</code>
                  </p>
                )}
              </div>
              <div className="flex gap-2">
                <button onClick={saveAgentSelection} disabled={busy} className={btnPrimary}>Save for Repo</button>
                <button onClick={discoverAgents} disabled={busy} className={btnSecondary}>
                  <span className="flex items-center gap-1.5">
                    <IconRefresh className="h-3.5 w-3.5" />
                    Discover
                  </span>
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
