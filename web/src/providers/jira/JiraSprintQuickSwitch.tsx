import { useCallback, useEffect, useState } from "react";
import { api } from "../../api";
import { IconRefresh } from "../../components/icons";

type Binding = {
  provider_account_id: string;
  provider_resource_id: string;
  provider_id: string;
  config_json?: string;
};

type ProviderResource = {
  id: string;
  provider_account_id: string;
  provider_id: string;
  external_id: string;
  name: string;
  extra_json: string;
};

type JiraSprint = {
  id: string;
  name: string;
  state: string;
  startDate: string | null;
  endDate: string | null;
  goal: string | null;
};

export function JiraSprintQuickSwitch({
  selectedRepoId,
  busy,
  onBusyChange,
  onError,
  onInfo,
  onTasksRefresh,
  refreshHint,
}: {
  selectedRepoId: string;
  busy: boolean;
  onBusyChange: (v: boolean) => void;
  onError: (msg: string) => void;
  onInfo: (msg: string) => void;
  onTasksRefresh: () => void;
  refreshHint: string;
}) {
  const [binding, setBinding] = useState<Binding | null>(null);
  const [sprints, setSprints] = useState<JiraSprint[]>([]);
  const [selectedSprintId, setSelectedSprintId] = useState("");

  const loadBinding = useCallback(async () => {
    if (!selectedRepoId) {
      setBinding(null);
      setSprints([]);
      setSelectedSprintId("");
      return;
    }

    try {
      const payload = await api<{ bindings: Binding[]; resources: ProviderResource[] }>(
        `/api/providers/jira/bindings?repo_id=${selectedRepoId}`
      );
      const nextBinding = payload.bindings[0] ?? null;
      setBinding(nextBinding);
      if (!nextBinding) {
        setSprints([]);
        setSelectedSprintId("");
        return;
      }

      const config = nextBinding.config_json ? JSON.parse(nextBinding.config_json) as Record<string, unknown> : {};
      setSelectedSprintId(config.sprint_id ? String(config.sprint_id) : "");

      const sprintPayload = await api<{ sprints: JiraSprint[] }>(
        `/api/providers/jira/accounts/${nextBinding.provider_account_id}/resources/${nextBinding.provider_resource_id}/sprints`
      );
      setSprints(sprintPayload.sprints);
    } catch {
      setBinding(null);
      setSprints([]);
      setSelectedSprintId("");
    }
  }, [selectedRepoId]);

  useEffect(() => { void loadBinding(); }, [loadBinding, refreshHint]);

  const syncCurrentSelection = useCallback(async (sprintId: string) => {
    if (!selectedRepoId || !binding) return;
    const sprint = sprints.find((item) => item.id === sprintId);
    onError("");
    onInfo("");
    onBusyChange(true);
    try {
      await api("/api/providers/jira/bind", {
        method: "POST",
        body: JSON.stringify({
          repoId: selectedRepoId,
          accountId: binding.provider_account_id,
          resourceId: binding.provider_resource_id,
          config: {
            sprint_id: sprintId || null,
            sprint_name: sprint?.name ?? null,
          },
        }),
      });
      const payload = await api<{ synced: number }>(
        "/api/tasks/sync",
        { method: "POST", body: JSON.stringify({ repoId: selectedRepoId }) }
      );
      onTasksRefresh();
      onInfo(
        sprintId
          ? `${sprint?.name ?? "Selected sprint"} synced. ${payload.synced} tasks updated.`
          : `All assigned issues synced. ${payload.synced} tasks updated.`
      );
      setSelectedSprintId(sprintId);
      await loadBinding();
    } catch (e) {
      onError((e as Error).message);
    } finally {
      onBusyChange(false);
    }
  }, [binding, loadBinding, onBusyChange, onError, onInfo, onTasksRefresh, selectedRepoId, sprints]);

  if (!binding) return null;

  return (
    <div className="flex items-center gap-1.5">
      <select
        className="min-w-[200px] appearance-none rounded-full border-0 bg-transparent px-2 py-1 text-[11px] text-text-primary focus:outline-none focus:shadow-[0_0_0_2px_var(--color-brand-glow)]"
        value={selectedSprintId}
        disabled={busy}
        onChange={(e) => void syncCurrentSelection(e.target.value)}
      >
        <option value="">All Assigned</option>
        {sprints.map((sprint) => (
          <option key={sprint.id} value={sprint.id}>
            {formatSprintLabel(sprint)}
          </option>
        ))}
      </select>
      <button
        type="button"
        onClick={() => void syncCurrentSelection(selectedSprintId)}
        disabled={busy}
        className="flex h-6 w-6 items-center justify-center rounded-full text-text-muted transition hover:bg-surface-200 hover:text-text-primary disabled:opacity-40"
        title="Sync selected sprint"
      >
        <IconRefresh className={`h-3 w-3 ${busy ? "animate-spin" : ""}`} />
      </button>
    </div>
  );
}

function formatSprintLabel(sprint: JiraSprint): string {
  const state = sprint.state ? sprint.state[0].toUpperCase() + sprint.state.slice(1) : "Unknown";
  return `${sprint.name} (${state})`;
}
