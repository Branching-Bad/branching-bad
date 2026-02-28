import { api } from "../../api";
import type { Task } from "../../types";
import { IconRefresh } from "../../components/icons";
import { btnSecondary } from "../../components/shared";
import type { NavActionProps } from "../types";

export function JiraSyncButton({ selectedRepoId, busy, onBusyChange, onTasksUpdated, onError, onInfo }: NavActionProps) {
  async function syncTasks() {
    if (!selectedRepoId) { onError("Select a repo first."); return; }
    onError(""); onInfo(""); onBusyChange(true);
    try {
      const payload = await api<{ tasks: Task[]; synced: number }>("/api/tasks/sync", {
        method: "POST",
        body: JSON.stringify({ repoId: selectedRepoId }),
      });
      onTasksUpdated();
      onInfo(`${payload.synced} tasks synced.`);
    } catch (e) { onError((e as Error).message); } finally { onBusyChange(false); }
  }

  return (
    <button
      onClick={() => void syncTasks()}
      disabled={busy || !selectedRepoId}
      className={`${btnSecondary} flex items-center gap-1.5 !px-3 !py-1.5 text-xs`}
    >
      <IconRefresh className="h-3.5 w-3.5" />
      Sync
    </button>
  );
}
