import { api } from "../../api";
import type { Task } from "../../types";
import { IconRefresh } from "../../components/icons";
import type { DrawerSectionProps } from "../types";

export function JiraDrawerSection({ selectedRepoId, busy, onBusyChange, onTasksRefresh, onError, onInfo }: DrawerSectionProps) {
  async function syncTasks() {
    if (busy) { onInfo("Another action is still running. Wait for it to finish, then try again."); return; }
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
    <div className="space-y-2">
      <button
        onClick={() => void syncTasks()}
        aria-disabled={busy}
        className={`flex w-full items-center gap-2 rounded-lg border px-3 py-2 text-xs font-medium transition ${
          busy
            ? "cursor-not-allowed border-border-default bg-surface-200/60 text-text-muted"
            : "cursor-pointer border-border-default bg-surface-200 text-text-secondary hover:bg-surface-300"
        }`}
        title={busy ? "Another action is in progress" : !selectedRepoId ? "Select a repo first" : "Sync Jira tasks"}
      >
        <IconRefresh className={`h-3.5 w-3.5 ${busy ? "animate-spin" : ""}`} />
        {busy ? "Syncing..." : "Sync Tasks"}
      </button>
      {!selectedRepoId && (
        <p className="text-[11px] text-text-muted">
          No active repository selected. Pick one from the top bar or Settings.
        </p>
      )}
      {busy && (
        <p className="text-[11px] text-text-muted">
          Another operation is using the global busy state. When it clears, this button will work again.
        </p>
      )}
    </div>
  );
}
