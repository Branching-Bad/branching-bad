import { useState, useEffect, useCallback } from "react";
import type { FormEvent } from "react";
import type { Repo, AgentProfile, RepositoryRule } from "../types";
import type { TaskMemory } from "../hooks/useMemoryState";
import type { GlossaryTerm } from "../hooks/useGlossaryState";
import { GlossaryPanel } from "./GlossaryPanel";
import { ImportDialog } from "./ImportDialog";
import { TaskDefaultsSection } from "./TaskDefaultsSection";
import { api } from "../api";
import { IconX, IconRefresh, IconFolder } from "./icons";
import { inputClass, selectClass, btnPrimary, btnSecondary } from "./shared";
import { FolderPicker } from "./FolderPicker";

/* ── Inline Rule Editor Row ── */
function RuleRow({
  rule,
  onUpdate,
  onDelete,
}: {
  rule: RepositoryRule;
  onUpdate: (id: string, content: string) => void;
  onDelete: (id: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(rule.content);

  return editing ? (
    <div className="flex items-start gap-1.5">
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={2}
        className="flex-1 rounded-md border border-border-strong bg-surface-200 px-2.5 py-1.5 text-xs text-text-primary focus:border-brand focus:outline-none"
      />
      <button
        onClick={() => { onUpdate(rule.id, text); setEditing(false); }}
        className="shrink-0 rounded-md bg-brand px-2.5 py-1 text-[10px] font-medium text-white hover:bg-brand/80"
      >
        Save
      </button>
      <button
        onClick={() => { setText(rule.content); setEditing(false); }}
        className="shrink-0 rounded-md bg-surface-300 px-2.5 py-1 text-[10px] font-medium text-text-muted hover:text-text-primary"
      >
        Cancel
      </button>
    </div>
  ) : (
    <div className="group flex items-start gap-2 rounded-lg border border-border-default bg-surface-200 px-3 py-2">
      <p className="min-w-0 flex-1 text-xs leading-relaxed text-text-secondary">{rule.content}</p>
      {rule.source === "review_comment" && (
        <span className="shrink-0 rounded bg-brand/15 px-1.5 py-0.5 text-[9px] font-medium text-brand">pinned</span>
      )}
      <button
        onClick={() => setEditing(true)}
        className="shrink-0 text-text-muted opacity-0 transition group-hover:opacity-100 hover:text-text-primary"
        title="Edit"
      >
        <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
        </svg>
      </button>
      <button
        onClick={() => onDelete(rule.id)}
        className="shrink-0 text-text-muted opacity-0 transition group-hover:opacity-100 hover:text-status-danger"
        title="Delete"
      >
        <IconX className="h-3 w-3" />
      </button>
    </div>
  );
}

/* ── Rules Section (reused for global + repo) ── */
function RulesSection({
  title,
  rules,
  onAdd,
  onUpdate,
  onDelete,
}: {
  title: string;
  rules: RepositoryRule[];
  onAdd: (content: string) => void;
  onUpdate: (id: string, content: string) => void;
  onDelete: (id: string) => void;
}) {
  const [newContent, setNewContent] = useState("");

  return (
    <div className="space-y-2.5">
      <h4 className="text-xs font-semibold text-text-muted uppercase tracking-wider">{title}</h4>
      {rules.length > 0 ? (
        <div className="space-y-1.5">
          {rules.map((r) => (
            <RuleRow key={r.id} rule={r} onUpdate={onUpdate} onDelete={onDelete} />
          ))}
        </div>
      ) : (
        <p className="text-[11px] text-text-muted italic">No rules yet.</p>
      )}
      <div className="flex gap-2">
        <textarea
          value={newContent}
          onChange={(e) => setNewContent(e.target.value)}
          placeholder="Add a new rule..."
          rows={2}
          className="flex-1 rounded-md border border-border-strong bg-surface-200 px-2.5 py-1.5 text-xs text-text-primary placeholder:text-text-muted focus:border-brand focus:outline-none"
        />
        <button
          onClick={() => {
            if (newContent.trim()) {
              onAdd(newContent.trim());
              setNewContent("");
            }
          }}
          disabled={!newContent.trim()}
          className="self-end shrink-0 rounded-md bg-brand px-3 py-1.5 text-[11px] font-medium text-white transition hover:bg-brand/80 disabled:bg-surface-400 disabled:text-text-muted disabled:cursor-not-allowed"
        >
          Add
        </button>
      </div>
    </div>
  );
}

/* ── Nav item icons ── */

function IconAgent({ className = "w-4 h-4" }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904 9 18.75l-.813-2.846a4.5 4.5 0 0 0-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 0 0 3.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 0 0 3.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 0 0-3.09 3.09ZM18.259 8.715 18 9.75l-.259-1.035a3.375 3.375 0 0 0-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 0 0 2.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 0 0 2.455 2.456L21.75 6l-1.036.259a3.375 3.375 0 0 0-2.455 2.456ZM16.894 20.567 16.5 21.75l-.394-1.183a2.25 2.25 0 0 0-1.423-1.423L13.5 18.75l1.183-.394a2.25 2.25 0 0 0 1.423-1.423l.394-1.183.394 1.183a2.25 2.25 0 0 0 1.423 1.423l1.183.394-1.183.394a2.25 2.25 0 0 0-1.423 1.423Z" />
    </svg>
  );
}

function IconData({ className = "w-4 h-4" }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M20.25 6.375c0 2.278-3.694 4.125-8.25 4.125S3.75 8.653 3.75 6.375m16.5 0c0-2.278-3.694-4.125-8.25-4.125S3.75 4.097 3.75 6.375m16.5 0v11.25c0 2.278-3.694 4.125-8.25 4.125s-8.25-1.847-8.25-4.125V6.375m16.5 0v3.75m-16.5-3.75v3.75m16.5 0v3.75C20.25 16.153 16.556 18 12 18s-8.25-1.847-8.25-4.125v-3.75m16.5 0c0 2.278-3.694 4.125-8.25 4.125s-8.25-1.847-8.25-4.125" />
    </svg>
  );
}

function IconRules({ className = "w-4 h-4" }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h3.75M9 15h3.75M9 18h3.75m3 .75H18a2.25 2.25 0 0 0 2.25-2.25V6.108c0-1.135-.845-2.098-1.976-2.192a48.424 48.424 0 0 0-1.123-.08m-5.801 0c-.065.21-.1.433-.1.664 0 .414.336.75.75.75h4.5a.75.75 0 0 0 .75-.75 2.25 2.25 0 0 0-.1-.664m-5.8 0A2.251 2.251 0 0 1 13.5 2.25H15c1.012 0 1.867.668 2.15 1.586m-5.8 0c-.376.023-.75.05-1.124.08C9.095 4.01 8.25 4.973 8.25 6.108V8.25m0 0H4.875c-.621 0-1.125.504-1.125 1.125v11.25c0 .621.504 1.125 1.125 1.125h9.75c.621 0 1.125-.504 1.125-1.125V9.375c0-.621-.504-1.125-1.125-1.125H8.25ZM6.75 12h.008v.008H6.75V12Zm0 3h.008v.008H6.75V15Zm0 3h.008v.008H6.75V18Z" />
    </svg>
  );
}

function IconMemory({ className = "w-4 h-4" }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 18v-5.25m0 0a6.01 6.01 0 0 0 1.5-.189m-1.5.189a6.01 6.01 0 0 1-1.5-.189m3.75 7.478a12.06 12.06 0 0 1-4.5 0m3.75 2.383a14.406 14.406 0 0 1-3 0M14.25 18v-.192c0-.983.658-1.823 1.508-2.316a7.5 7.5 0 1 0-7.517 0c.85.493 1.509 1.333 1.509 2.316V18" />
    </svg>
  );
}

function IconGlossary({ className = "w-4 h-4" }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.042A8.967 8.967 0 0 0 6 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 0 1 6 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 0 1 6-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0 0 18 18a8.967 8.967 0 0 0-6 2.292m0-14.25v14.25" />
    </svg>
  );
}

const navItems = [
  { key: "repo", label: "Repository", icon: IconFolder },
  { key: "agent", label: "AI Agent", icon: IconAgent },
  { key: "rules", label: "Rules", icon: IconRules },
  { key: "glossary", label: "Glossary", icon: IconGlossary },
  { key: "memory", label: "Memories", icon: IconMemory },
  { key: "data", label: "Data", icon: IconData },
] as const;

/* ── Update Section ── */
function UpdateSection() {
  const [updating, setUpdating] = useState(false);
  const [result, setResult] = useState<{ success: boolean; message: string } | null>(null);

  const handleUpdate = useCallback(async () => {
    setUpdating(true); setResult(null);
    try {
      const res = await api<{ success: boolean; message: string }>("/api/system/update", { method: "POST" });
      setResult(res);
    } catch (e) {
      setResult({ success: false, message: (e as Error).message });
    } finally { setUpdating(false); }
  }, []);

  return (
    <div className="rounded-xl border border-border-default bg-surface-200 p-5 space-y-3">
      <div>
        <h4 className="text-xs font-semibold text-text-secondary">Application Update</h4>
        <p className="mt-1 text-[11px] text-text-muted">
          Pull latest changes from GitHub and install dependencies.
        </p>
      </div>
      <button
        onClick={() => void handleUpdate()}
        disabled={updating}
        className={btnPrimary + " text-[11px]"}
      >
        {updating ? "Updating..." : "Check for Updates"}
      </button>
      {result && (
        <pre className={`mt-2 rounded-lg border px-3 py-2 text-[11px] whitespace-pre-wrap ${
          result.success
            ? "border-brand/30 bg-brand-tint text-brand"
            : "border-error-border bg-error-bg text-error-text"
        }`}>{result.message}</pre>
      )}
    </div>
  );
}

/* ── Build Command Section ── */
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

export function SettingsModal({
  open, onClose, repos, agentProfiles,
  selectedRepoId, setSelectedRepoId, selectedProfileId, setSelectedProfileId,
  selectedProfile, busy, error: extError, info: extInfo,
  onRepoSubmit, discoverAgents, saveAgentSelection,
  repoPath, setRepoPath, repoName, setRepoName,
  onReposChange,
  globalRules, repoRules, onAddRule, onUpdateRule, onDeleteRule, onOptimizeRules, onBulkReplaceRules, onRulesRefresh,
  onClearOutputs,
  memories, memoryTotal, memoryPage, memoryTotalPages, memoryLoading,
  memorySearchQuery, onMemorySearchChange,
  onLoadMemories, onDeleteMemory,
  glossaryTerms, glossaryLoading,
  onAddGlossaryTerm, onUpdateGlossaryTerm, onDeleteGlossaryTerm,
  onExportGlossary, onImportGlossary,
  onExportMemories, onImportMemories,
}: {
  open: boolean; onClose: () => void;
  repos: Repo[]; agentProfiles: AgentProfile[];
  selectedRepoId: string; setSelectedRepoId: (v: string) => void;
  selectedProfileId: string; setSelectedProfileId: (v: string) => void;
  selectedProfile: AgentProfile | null;
  busy: boolean;
  error: string; info: string;
  onRepoSubmit: (e: FormEvent) => void;
  discoverAgents: () => void;
  saveAgentSelection: () => void;
  repoPath: string; setRepoPath: (v: string) => void;
  repoName: string; setRepoName: (v: string) => void;
  onReposChange?: () => void;
  globalRules?: RepositoryRule[];
  repoRules?: RepositoryRule[];
  onAddRule?: (repoId: string | null, content: string) => Promise<void>;
  onUpdateRule?: (id: string, content: string) => Promise<void>;
  onDeleteRule?: (id: string) => Promise<void>;
  onOptimizeRules?: (profileId: string, repoId?: string, instruction?: string, scope?: string) => Promise<string[]>;
  onBulkReplaceRules?: (repoId: string | null, contents: string[]) => Promise<void>;
  onRulesRefresh?: () => void;
  onClearOutputs?: () => Promise<void>;
  memories?: TaskMemory[];
  memoryTotal?: number;
  memoryPage?: number;
  memoryTotalPages?: number;
  memoryLoading?: boolean;
  memorySearchQuery?: string;
  onMemorySearchChange?: (q: string) => void;
  onLoadMemories?: (repoId: string, query?: string, page?: number) => Promise<void>;
  onDeleteMemory?: (id: string, repoId: string, query?: string, page?: number) => Promise<void>;
  glossaryTerms?: GlossaryTerm[];
  glossaryLoading?: boolean;
  onAddGlossaryTerm?: (repoId: string, term: string, description: string) => Promise<void>;
  onUpdateGlossaryTerm?: (id: string, term: string, description: string, repoId: string) => Promise<void>;
  onDeleteGlossaryTerm?: (id: string, repoId: string) => Promise<void>;
  onExportGlossary?: (repoId: string) => void;
  onImportGlossary?: (repoId: string, file: File, strategy: "skip" | "update") => Promise<{ created: number; updated: number; skipped: number }>;
  onExportMemories?: (repoId: string) => void;
  onImportMemories?: (repoId: string, file: File, strategy: "skip" | "update") => Promise<{ created: number; updated: number; skipped: number }>;
}) {
  const [tab, setTab] = useState("repo");
  const [branches, setBranches] = useState<string[]>([]);
  const [optimizing, setOptimizing] = useState(false);
  const [optimizePreview, setOptimizePreview] = useState<string[] | null>(null);
  const [optimizeProfileId, setOptimizeProfileId] = useState("");
  const [optimizeInstruction, setOptimizeInstruction] = useState("");
  const [optimizeScope, setOptimizeScope] = useState<"global" | "repo">("global");
  const [memoryImportOpen, setMemoryImportOpen] = useState(false);
  const selectedRepo = repos.find((r) => r.id === selectedRepoId);

  useEffect(() => {
    if (!selectedRepoId || !open) { setBranches([]); return; }
    api<{ branches: string[]; default: string }>(`/api/repos/${encodeURIComponent(selectedRepoId)}/branches`)
      .then((res) => setBranches(res.branches))
      .catch(() => setBranches([]));
  }, [selectedRepoId, open]);

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

  const handleAddRule = useCallback(async (repoId: string | null, content: string) => {
    if (!onAddRule) return;
    await onAddRule(repoId, content);
    onRulesRefresh?.();
  }, [onAddRule, onRulesRefresh]);

  const handleUpdateRule = useCallback(async (id: string, content: string) => {
    if (!onUpdateRule) return;
    await onUpdateRule(id, content);
    onRulesRefresh?.();
  }, [onUpdateRule, onRulesRefresh]);

  const handleDeleteRule = useCallback(async (id: string) => {
    if (!onDeleteRule) return;
    await onDeleteRule(id);
    onRulesRefresh?.();
  }, [onDeleteRule, onRulesRefresh]);

  const handleOptimize = useCallback(async () => {
    if (!onOptimizeRules || !optimizeProfileId) return;
    setOptimizing(true);
    try {
      const result = await onOptimizeRules(optimizeProfileId, selectedRepoId || undefined, optimizeInstruction || undefined, optimizeScope);
      setOptimizePreview(result);
    } catch { /* silent */ }
    setOptimizing(false);
  }, [onOptimizeRules, optimizeProfileId, selectedRepoId, optimizeInstruction, optimizeScope]);

  const handleApplyOptimized = useCallback(async () => {
    if (!optimizePreview) return;
    const repoId = optimizeScope === "repo" ? (selectedRepoId || null) : null;
    await onBulkReplaceRules?.(repoId, optimizePreview);
    setOptimizePreview(null);
    onRulesRefresh?.();
  }, [optimizePreview, optimizeScope, selectedRepoId, onBulkReplaceRules, onRulesRefresh]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-6">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />

      <div className="relative flex h-[85vh] w-full max-w-6xl overflow-hidden rounded-[var(--radius-2xl)] border border-border-default bg-surface-100 shadow-[var(--shadow-lg)]">
        {/* ── Left sidebar nav ── */}
        <div className="flex w-56 shrink-0 flex-col border-r border-border-default bg-surface-0/70 backdrop-blur-md">
          <div className="px-5 pt-5 pb-4">
            <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-text-muted">
              Settings
            </span>
          </div>
          <nav className="flex flex-1 flex-col gap-0.5 px-2.5 pb-4">
            {navItems.map((item) => {
              const active = tab === item.key;
              return (
                <button
                  key={item.key}
                  onClick={() => setTab(item.key)}
                  className={`group flex items-center gap-2.5 rounded-[var(--radius-md)] px-3 py-2 text-[13px] font-medium transition ${
                    active
                      ? "bg-brand-tint text-text-primary shadow-[inset_0_0_0_1px_var(--color-brand-glow)]"
                      : "text-text-secondary hover:bg-surface-200 hover:text-text-primary"
                  }`}
                >
                  <item.icon
                    className={`h-4 w-4 ${
                      active ? "text-brand" : "text-text-muted group-hover:text-text-secondary"
                    }`}
                  />
                  {item.label}
                </button>
              );
            })}
          </nav>
        </div>

        {/* ── Right content area ── */}
        <div className="flex min-w-0 flex-1 flex-col">
          {/* Header */}
          <div className="flex items-center justify-between border-b border-border-default bg-surface-100/70 px-6 py-4 backdrop-blur-md">
            <h3 className="text-[15px] font-semibold text-text-primary">
              {navItems.find((n) => n.key === tab)?.label}
            </h3>
            <button
              onClick={onClose}
              aria-label="Close settings"
              className="flex h-7 w-7 items-center justify-center rounded-full text-text-muted transition hover:bg-surface-200 hover:text-text-primary"
            >
              <IconX className="h-3.5 w-3.5" />
            </button>
          </div>

          {/* Alerts */}
          {(extError || extInfo) && (
            <div className="space-y-2 px-6 pt-4">
              {extError && (
                <div className="rounded-[var(--radius-md)] border border-error-border bg-error-bg px-3 py-2 text-sm text-error-text">
                  {extError}
                </div>
              )}
              {extInfo && (
                <div className="rounded-[var(--radius-md)] border border-info-border bg-info-bg px-3 py-2 text-sm text-info-text">
                  {extInfo}
                </div>
              )}
            </div>
          )}

          {/* Scrollable content */}
          <div className="flex-1 overflow-y-auto px-6 py-5">
            {tab === "repo" && (
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
            )}

            {tab === "agent" && (
              <div className="space-y-5">
                <div>
                  <label className="mb-1.5 block text-xs font-semibold text-text-muted uppercase tracking-wider">Agent / Model</label>
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

            {tab === "rules" && (
              <div className="space-y-6">
                <RulesSection
                  title="Global Rules"
                  rules={globalRules ?? []}
                  onAdd={(content) => void handleAddRule(null, content)}
                  onUpdate={(id, content) => void handleUpdateRule(id, content)}
                  onDelete={(id) => void handleDeleteRule(id)}
                />

                {selectedRepoId && (
                  <RulesSection
                    title={`Repo Rules${selectedRepo ? ` (${selectedRepo.name})` : ""}`}
                    rules={repoRules ?? []}
                    onAdd={(content) => void handleAddRule(selectedRepoId, content)}
                    onUpdate={(id, content) => void handleUpdateRule(id, content)}
                    onDelete={(id) => void handleDeleteRule(id)}
                  />
                )}

                {/* Optimize with AI */}
                <div className="rounded-xl border border-border-default bg-surface-200 p-4 space-y-3">
                  <div>
                    <h4 className="text-xs font-semibold text-text-secondary">Optimize with AI</h4>
                    <p className="mt-1 text-[11px] text-text-muted">
                      Merge duplicates, remove contradictions, and simplify your rules.
                    </p>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="mb-1 block text-[11px] text-text-muted">Scope</label>
                      <select
                        className={`${selectClass} !py-1.5 !text-xs`}
                        value={optimizeScope}
                        onChange={(e) => { setOptimizeScope(e.target.value as "global" | "repo"); setOptimizePreview(null); }}
                      >
                        <option value="global">Global Rules</option>
                        {selectedRepoId && (
                          <option value="repo">Repo Rules{selectedRepo ? ` (${selectedRepo.name})` : ""}</option>
                        )}
                      </select>
                    </div>
                    <div>
                      <label className="mb-1 block text-[11px] text-text-muted">Agent</label>
                      <select
                        className={`${selectClass} !py-1.5 !text-xs`}
                        value={optimizeProfileId}
                        onChange={(e) => setOptimizeProfileId(e.target.value)}
                      >
                        <option value="">Select agent</option>
                        {agentProfiles.map((p) => (
                          <option key={p.id} value={p.id}>{`${p.agent_name} \u00B7 ${p.model}`}</option>
                        ))}
                      </select>
                    </div>
                  </div>
                  <div>
                    <label className="mb-1 block text-[11px] text-text-muted">Instructions</label>
                    <textarea
                      value={optimizeInstruction}
                      onChange={(e) => setOptimizeInstruction(e.target.value)}
                      placeholder="e.g. 'group by category', 'keep security rules separate' (optional)"
                      rows={2}
                      className="w-full rounded-md border border-border-strong bg-surface-300 px-2.5 py-1.5 text-xs text-text-primary placeholder:text-text-muted focus:border-brand focus:outline-none"
                    />
                  </div>
                  <button
                    onClick={() => void handleOptimize()}
                    disabled={optimizing || !optimizeProfileId || (optimizeScope === "global" ? (globalRules?.length ?? 0) === 0 : (repoRules?.length ?? 0) === 0)}
                    className="w-full rounded-md bg-brand px-4 py-1.5 text-[11px] font-medium text-white transition hover:bg-brand/80 disabled:bg-surface-400 disabled:text-text-muted disabled:cursor-not-allowed"
                  >
                    {optimizing ? "Optimizing..." : "Optimize"}
                  </button>

                  {optimizePreview && (
                    <div className="space-y-2.5">
                      <h5 className="text-[11px] font-semibold text-text-secondary">Preview ({optimizePreview.length} rules)</h5>
                      <div className="space-y-1.5">
                        {optimizePreview.map((r, i) => (
                          <div key={i} className="rounded-lg border border-brand/20 bg-brand/5 px-3 py-1.5 text-xs text-text-secondary">
                            {r}
                          </div>
                        ))}
                      </div>
                      <div className="flex gap-2">
                        <button
                          onClick={() => void handleApplyOptimized()}
                          className="rounded-md bg-brand px-4 py-1.5 text-[11px] font-medium text-white transition hover:bg-brand/80"
                        >
                          Apply
                        </button>
                        <button
                          onClick={() => setOptimizePreview(null)}
                          className="rounded-md bg-surface-300 px-4 py-1.5 text-[11px] font-medium text-text-muted hover:text-text-primary"
                        >
                          Discard
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}

            {tab === "glossary" && (
              <GlossaryPanel
                terms={glossaryTerms ?? []}
                loading={glossaryLoading ?? false}
                selectedRepoId={selectedRepoId}
                onAdd={onAddGlossaryTerm ?? (async () => {})}
                onUpdate={onUpdateGlossaryTerm ?? (async () => {})}
                onDelete={onDeleteGlossaryTerm ?? (async () => {})}
                onExport={onExportGlossary}
                onImport={onImportGlossary}
              />
            )}

            {tab === "memory" && (
              <div className="space-y-4">
                <div>
                  <label className="mb-1.5 block text-xs font-semibold text-text-muted uppercase tracking-wider">Search Memories</label>
                  <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={memorySearchQuery ?? ""}
                    onChange={(e) => onMemorySearchChange?.(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") void onLoadMemories?.(selectedRepoId, memorySearchQuery, 1);
                    }}
                    placeholder="Enter keywords..."
                    className={`${inputClass} flex-1 !py-1.5 !text-xs`}
                  />
                  <button
                    onClick={() => void onLoadMemories?.(selectedRepoId, memorySearchQuery, 1)}
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
                        disabled={(memories ?? []).length === 0}
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

                {selectedRepoId && (memories ?? []).length === 0 && !memoryLoading && (
                  <p className="text-[11px] text-text-muted italic">No memories found.</p>
                )}

                <div className="space-y-2">
                  {(memories ?? []).map((m) => (
                    <div key={m.id} className="group rounded-lg border border-border-default bg-surface-200 px-3 py-2.5 space-y-1.5">
                      <div className="flex items-start justify-between gap-2">
                        <h5 className="text-xs font-medium text-text-primary leading-snug">{m.title}</h5>
                        <button
                          onClick={() => void onDeleteMemory?.(m.id, selectedRepoId, memorySearchQuery, memoryPage)}
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
                {(memoryTotalPages ?? 1) > 1 && (
                  <div className="flex items-center justify-between pt-2">
                    <span className="text-[11px] text-text-muted">
                      {memoryTotal ?? 0} memories &middot; Page {memoryPage ?? 1} of {memoryTotalPages ?? 1}
                    </span>
                    <div className="flex gap-1.5">
                      <button
                        onClick={() => void onLoadMemories?.(selectedRepoId, memorySearchQuery, (memoryPage ?? 1) - 1)}
                        disabled={(memoryPage ?? 1) <= 1 || memoryLoading}
                        className="rounded-md bg-surface-300 px-2.5 py-1 text-[10px] font-medium text-text-muted hover:text-text-primary disabled:text-text-muted/40 disabled:cursor-not-allowed"
                      >
                        Prev
                      </button>
                      <button
                        onClick={() => void onLoadMemories?.(selectedRepoId, memorySearchQuery, (memoryPage ?? 1) + 1)}
                        disabled={(memoryPage ?? 1) >= (memoryTotalPages ?? 1) || memoryLoading}
                        className="rounded-md bg-surface-300 px-2.5 py-1 text-[10px] font-medium text-text-muted hover:text-text-primary disabled:text-text-muted/40 disabled:cursor-not-allowed"
                      >
                        Next
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}

            {tab === "data" && (
              <div className="space-y-5">
                <UpdateSection />
                <div className="rounded-xl border border-border-default bg-surface-200 p-5 space-y-3">
                  <div>
                    <h4 className="text-xs font-semibold text-text-secondary">Live Output Logs</h4>
                    <p className="mt-1 text-[11px] text-text-muted">
                      Clear all persisted live output logs for all tasks. This frees up storage but removes output history.
                    </p>
                  </div>
                  <button
                    onClick={() => void onClearOutputs?.()}
                    className="rounded-md bg-status-danger px-4 py-1.5 text-[11px] font-medium text-white transition hover:bg-status-danger/90"
                  >
                    Clear All Outputs
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
