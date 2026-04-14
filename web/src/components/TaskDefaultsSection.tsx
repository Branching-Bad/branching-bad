import { useState, useEffect, useCallback } from "react";
import type { TaskDefaults } from "../types";
import { api } from "../api";
import { selectClass, btnSecondary } from "./shared";
import { IconX } from "./icons";

const PROVIDER_NAMES = ["jira", "sentry", "postgres", "cloudwatch", "elasticsearch", "sonarqube"];

const PRIORITY_OPTIONS = ["", "low", "medium", "high", "critical"];

/* ── Single defaults row (repo or provider override) ── */
function DefaultsRow({
  label,
  defaults,
  onSave,
  onDelete,
}: {
  label: string;
  defaults: Partial<TaskDefaults>;
  onSave: (vals: Omit<TaskDefaults, "id" | "repo_id" | "provider_name">) => Promise<void>;
  onDelete?: () => Promise<void>;
}) {
  const [requirePlan, setRequirePlan] = useState(defaults.require_plan ?? true);
  const [autoApprovePlan, setAutoApprovePlan] = useState(defaults.auto_approve_plan ?? false);
  const [autoStart, setAutoStart] = useState(defaults.auto_start ?? false);
  const [useWorktree, setUseWorktree] = useState(defaults.use_worktree ?? true);
  const [carryDirtyState, setCarryDirtyState] = useState(defaults.carry_dirty_state ?? false);
  const [priority, setPriority] = useState(defaults.priority ?? "");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setRequirePlan(defaults.require_plan ?? true);
    setAutoApprovePlan(defaults.auto_approve_plan ?? false);
    setAutoStart(defaults.auto_start ?? false);
    setUseWorktree(defaults.use_worktree ?? true);
    setCarryDirtyState(defaults.carry_dirty_state ?? false);
    setPriority(defaults.priority ?? "");
  }, [defaults.require_plan, defaults.auto_approve_plan, defaults.auto_start, defaults.use_worktree, defaults.carry_dirty_state, defaults.priority]);

  const handleSave = useCallback(async () => {
    setSaving(true);
    try {
      await onSave({ require_plan: requirePlan, auto_approve_plan: autoApprovePlan, auto_start: autoStart, use_worktree: useWorktree, carry_dirty_state: carryDirtyState, priority: priority || null });
    } finally {
      setSaving(false);
    }
  }, [onSave, requirePlan, autoApprovePlan, autoStart, useWorktree, carryDirtyState, priority]);

  return (
    <div className="rounded-lg border border-border-default bg-surface-200 px-3 py-2.5 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] font-semibold text-text-secondary uppercase tracking-wider">{label}</span>
        {onDelete && (
          <button
            onClick={() => void onDelete()}
            className="text-text-muted hover:text-status-danger transition"
            title="Remove override"
          >
            <IconX className="h-3 w-3" />
          </button>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
        {([
          ["requirePlan", "Require Plan", requirePlan, setRequirePlan],
          ["autoApprovePlan", "Auto-Approve Plan", autoApprovePlan, setAutoApprovePlan],
          ["autoStart", "Auto Start", autoStart, setAutoStart],
          ["useWorktree", "Use Worktree", useWorktree, setUseWorktree],
          ["carryDirtyState", "Carry Dirty State", carryDirtyState, setCarryDirtyState],
        ] as [string, string, boolean, (v: boolean) => void][]).map(([key, lbl, val, setter]) => (
          <label key={key} className="flex items-center gap-1.5 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={val}
              onChange={(e) => setter(e.target.checked)}
              className="h-3.5 w-3.5 rounded border-border-strong accent-brand"
            />
            <span className="text-[11px] text-text-secondary">{lbl}</span>
          </label>
        ))}
        <div className="flex items-center gap-1.5">
          <span className="text-[11px] text-text-secondary">Priority</span>
          <select
            value={priority}
            onChange={(e) => setPriority(e.target.value)}
            className={`${selectClass} !w-auto !py-0.5 !px-2 !text-[11px]`}
          >
            {PRIORITY_OPTIONS.map((p) => (
              <option key={p} value={p}>{p || "—"}</option>
            ))}
          </select>
        </div>
      </div>
      <button
        onClick={() => void handleSave()}
        disabled={saving}
        className="rounded-md bg-brand px-2.5 py-1 text-[10px] font-medium text-white hover:bg-brand/80 disabled:bg-surface-400 disabled:text-text-muted disabled:cursor-not-allowed transition"
      >
        {saving ? "Saving..." : "Save"}
      </button>
    </div>
  );
}

/* ── Main section ── */
export function TaskDefaultsSection({ repoId }: { repoId: string }) {
  const [defaults, setDefaults] = useState<TaskDefaults[]>([]);
  const [addingProvider, setAddingProvider] = useState(false);
  const [newProvider, setNewProvider] = useState("");

  const load = useCallback(async () => {
    try {
      const res = await api<{ defaults: TaskDefaults[] }>(`/api/repos/${encodeURIComponent(repoId)}/task-defaults`);
      setDefaults(res.defaults);
    } catch { /* silent */ }
  }, [repoId]);

  useEffect(() => { void load(); }, [load]);

  const repoDefault = defaults.find((d) => d.provider_name === null);
  const providerOverrides = defaults.filter((d) => d.provider_name !== null);
  const usedProviders = new Set(providerOverrides.map((d) => d.provider_name));
  const availableProviders = PROVIDER_NAMES.filter((p) => !usedProviders.has(p));

  const saveDefaults = useCallback(async (
    providerName: string | null,
    vals: Omit<TaskDefaults, "id" | "repo_id" | "provider_name">,
  ) => {
    await api(`/api/repos/${encodeURIComponent(repoId)}/task-defaults`, {
      method: "PUT",
      body: JSON.stringify({
        providerName,
        requirePlan: vals.require_plan,
        autoApprovePlan: vals.auto_approve_plan,
        autoStart: vals.auto_start,
        useWorktree: vals.use_worktree,
        carryDirtyState: vals.carry_dirty_state,
        priority: vals.priority,
      }),
    });
    await load();
  }, [repoId, load]);

  const deleteOverride = useCallback(async (providerName: string) => {
    await api(`/api/repos/${encodeURIComponent(repoId)}/task-defaults?provider=${encodeURIComponent(providerName)}`, {
      method: "DELETE",
    });
    await load();
  }, [repoId, load]);

  const handleAddProvider = useCallback(async () => {
    if (!newProvider) return;
    await saveDefaults(newProvider, {
      require_plan: repoDefault?.require_plan ?? true,
      auto_approve_plan: repoDefault?.auto_approve_plan ?? false,
      auto_start: repoDefault?.auto_start ?? false,
      use_worktree: repoDefault?.use_worktree ?? true,
      carry_dirty_state: repoDefault?.carry_dirty_state ?? false,
      priority: repoDefault?.priority ?? null,
    });
    setAddingProvider(false);
    setNewProvider("");
  }, [newProvider, saveDefaults, repoDefault]);

  return (
    <div className="space-y-2.5">
      <h4 className="text-xs font-semibold text-text-muted uppercase tracking-wider">Task Defaults</h4>
      <p className="text-[11px] text-text-muted">
        Default values pre-filled when creating a new task. Provider overrides apply when a task is linked to that provider.
      </p>

      {/* Repo-level defaults */}
      <DefaultsRow
        label="Repo Defaults"
        defaults={repoDefault ?? {}}
        onSave={(vals) => saveDefaults(null, vals)}
      />

      {/* Provider overrides */}
      {providerOverrides.map((d) => (
        <DefaultsRow
          key={d.provider_name}
          label={`${d.provider_name} override`}
          defaults={d}
          onSave={(vals) => saveDefaults(d.provider_name, vals)}
          onDelete={() => deleteOverride(d.provider_name!)}
        />
      ))}

      {/* Add override */}
      {availableProviders.length > 0 && (
        addingProvider ? (
          <div className="flex items-center gap-2">
            <select
              value={newProvider}
              onChange={(e) => setNewProvider(e.target.value)}
              className={`${selectClass} !w-auto !py-1 !text-xs`}
            >
              <option value="">Select provider...</option>
              {availableProviders.map((p) => (
                <option key={p} value={p}>{p}</option>
              ))}
            </select>
            <button
              onClick={() => void handleAddProvider()}
              disabled={!newProvider}
              className="rounded-md bg-brand px-3 py-1 text-[11px] font-medium text-white hover:bg-brand/80 disabled:bg-surface-400 disabled:text-text-muted disabled:cursor-not-allowed transition"
            >
              Add
            </button>
            <button
              onClick={() => { setAddingProvider(false); setNewProvider(""); }}
              className={`${btnSecondary} !px-3 !py-1 !text-[11px]`}
            >
              Cancel
            </button>
          </div>
        ) : (
          <button
            onClick={() => setAddingProvider(true)}
            className="text-[11px] text-brand hover:text-brand/80 transition font-medium"
          >
            + Add Provider Override
          </button>
        )
      )}
    </div>
  );
}
