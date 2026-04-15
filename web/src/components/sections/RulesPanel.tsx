import { useState, useCallback } from "react";
import type { AgentProfile, Repo, RepositoryRule } from "../../types";
import { IconX } from "../icons";
import { selectClass } from "../shared";

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

/* ── Rules Panel ── */
export function RulesPanel({
  selectedRepoId,
  selectedRepo,
  agentProfiles,
  globalRules,
  repoRules,
  onAddRule,
  onUpdateRule,
  onDeleteRule,
  onOptimizeRules,
  onBulkReplaceRules,
  onRulesRefresh,
}: {
  selectedRepoId: string;
  selectedRepo: Repo | undefined;
  agentProfiles: AgentProfile[];
  globalRules: RepositoryRule[];
  repoRules: RepositoryRule[];
  onAddRule: (repoId: string | null, content: string) => Promise<void>;
  onUpdateRule: (id: string, content: string) => Promise<void>;
  onDeleteRule: (id: string) => Promise<void>;
  onOptimizeRules: (profileId: string, repoId?: string, instruction?: string, scope?: string) => Promise<string[]>;
  onBulkReplaceRules: (repoId: string | null, contents: string[]) => Promise<void>;
  onRulesRefresh: () => void;
}) {
  const [optimizing, setOptimizing] = useState(false);
  const [optimizePreview, setOptimizePreview] = useState<string[] | null>(null);
  const [optimizeProfileId, setOptimizeProfileId] = useState("");
  const [optimizeInstruction, setOptimizeInstruction] = useState("");
  const [optimizeScope, setOptimizeScope] = useState<"global" | "repo">("global");

  const handleAddRule = useCallback(async (repoId: string | null, content: string) => {
    await onAddRule(repoId, content);
    onRulesRefresh();
  }, [onAddRule, onRulesRefresh]);

  const handleUpdateRule = useCallback(async (id: string, content: string) => {
    await onUpdateRule(id, content);
    onRulesRefresh();
  }, [onUpdateRule, onRulesRefresh]);

  const handleDeleteRule = useCallback(async (id: string) => {
    await onDeleteRule(id);
    onRulesRefresh();
  }, [onDeleteRule, onRulesRefresh]);

  const handleOptimize = useCallback(async () => {
    if (!optimizeProfileId) return;
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
    await onBulkReplaceRules(repoId, optimizePreview);
    setOptimizePreview(null);
    onRulesRefresh();
  }, [optimizePreview, optimizeScope, selectedRepoId, onBulkReplaceRules, onRulesRefresh]);

  return (
    <div className="space-y-6">
      <RulesSection
        title="Global Rules"
        rules={globalRules}
        onAdd={(content) => void handleAddRule(null, content)}
        onUpdate={(id, content) => void handleUpdateRule(id, content)}
        onDelete={(id) => void handleDeleteRule(id)}
      />

      {selectedRepoId && (
        <RulesSection
          title={`Repo Rules${selectedRepo ? ` (${selectedRepo.name})` : ""}`}
          rules={repoRules}
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
          disabled={optimizing || !optimizeProfileId || (optimizeScope === "global" ? globalRules.length === 0 : repoRules.length === 0)}
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
  );
}
