import { api } from "../../api";
import type { Task } from "../../types";
import { IconRefresh } from "../../components/icons";
import type { DrawerSectionProps } from "../types";

export function JiraDrawerSection({ selectedRepoId, busy, onBusyChange, onTasksRefresh, onError, onInfo }: DrawerSectionProps) {
  async function syncTasks() {
    if (!selectedRepoId) { onError("Select a repo first."); return; }
    onError(""); onInfo(""); onBusyChange(true);
    try {
      const payload = await api<{ tasks: Task[]; synced: number }>("/api/tasks/sync", {
        method: "POST",
        body: JSON.stringify({ repoId: selectedRepoId }),
      });
      onTasksRefresh();
      onInfo(`${payload.synced} tasks synced.`);
    } catch (e) { onError((e as Error).message); } finally { onBusyChange(false); }
  }

  return (
    <div>
      <button
        onClick={() => void syncTasks()}
        disabled={busy || !selectedRepoId}
        className="flex items-center gap-2 rounded-lg border border-border-default bg-surface-200 px-3 py-2 text-xs font-medium text-text-secondary transition hover:bg-surface-300 w-full"
      >
        <IconRefresh className="h-3.5 w-3.5" />
        Sync Tasks
      </button>
    </div>
  );
}
