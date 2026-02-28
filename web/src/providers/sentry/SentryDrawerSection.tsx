import { useState, useEffect, useCallback } from "react";
import { api } from "../../api";
import type { ProviderItem } from "../../types";
import type { DrawerSectionProps } from "../types";

const PROVIDER_ID = "sentry";

export function SentryDrawerSection({ selectedRepoId, busy, onBusyChange, onTasksRefresh, onError, onInfo }: DrawerSectionProps) {
  const [items, setItems] = useState<ProviderItem[]>([]);

  const fetchItems = useCallback(async () => {
    if (!selectedRepoId) return;
    try {
      const payload = await api<{ items: ProviderItem[] }>(`/api/providers/${PROVIDER_ID}/items/${selectedRepoId}`);
      setItems(payload.items);
    } catch { /* silent */ }
  }, [selectedRepoId]);

  useEffect(() => {
    if (selectedRepoId) void fetchItems();
  }, [selectedRepoId, fetchItems]);

  async function syncNow() {
    if (!selectedRepoId) return;
    onError(""); onBusyChange(true);
    try {
      const result = await api<{ synced: number; errors?: string[] }>(`/api/providers/${PROVIDER_ID}/sync/${selectedRepoId}`, { method: "POST" });
      await fetchItems();
      if (result.errors?.length) {
        onError(`Sync issues: ${result.errors.join("; ")}`);
      } else {
        onInfo(`Sentry sync complete. ${result.synced} issue(s) synced.`);
      }
    } catch (e) { onError((e as Error).message); } finally { onBusyChange(false); }
  }

  async function ignoreItem(itemId: string) {
    try {
      await api(`/api/providers/${PROVIDER_ID}/items/${itemId}/action`, { method: "POST", body: JSON.stringify({ action: "ignore" }) });
      setItems((prev) => prev.filter((i) => i.id !== itemId));
    } catch (e) { onError((e as Error).message); }
  }

  async function createTask(itemId: string) {
    onError(""); onBusyChange(true);
    try {
      await api(`/api/providers/${PROVIDER_ID}/items/${itemId}/create-task`, { method: "POST" });
      setItems((prev) => prev.map((i) => i.id === itemId ? { ...i, status: "accepted" } : i));
      onTasksRefresh();
      onInfo("Task created from Sentry issue. Plan generation started.");
    } catch (e) { onError((e as Error).message); } finally { onBusyChange(false); }
  }

  const pending = items.filter((i) => i.status === "pending" || i.status === "regression");

  return (
    <div>
      <button
        onClick={() => void syncNow()}
        disabled={busy}
        className="mb-3 flex items-center gap-2 rounded-lg border border-border-default bg-surface-200 px-3 py-2 text-xs font-medium text-text-secondary transition hover:bg-surface-300 w-full"
      >
        Sync Sentry
      </button>
      {pending.length === 0 ? (
        <p className="text-xs text-text-muted">No pending issues.</p>
      ) : (
        <div className="space-y-2">
          {pending.map((item) => {
            const data = (() => { try { return JSON.parse(item.data_json); } catch { return {}; } })();
            return (
              <div key={item.id} className="rounded-xl border border-border-default bg-surface-200 p-3">
                <div className="flex items-center gap-2">
                  <span className={`inline-block h-2 w-2 rounded-full ${data.level === "fatal" ? "bg-red-600" : data.level === "error" ? "bg-red-400" : "bg-yellow-400"}`} />
                  <span className="truncate text-xs font-medium text-text-primary">{item.title}</span>
                  {item.status === "regression" && (
                    <span className="rounded bg-red-500/10 px-1.5 py-0.5 text-[10px] font-bold text-red-400 uppercase">Regression</span>
                  )}
                </div>
                <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-text-muted">
                  {data.culprit && <span>{data.culprit}</span>}
                  {data.level && <span>Level: {data.level}</span>}
                  {data.occurrence_count && <span>Count: {data.occurrence_count}</span>}
                </div>
                <div className="mt-2 flex gap-1.5">
                  <button
                    onClick={() => void createTask(item.id)}
                    disabled={busy}
                    className="rounded-md bg-brand px-3 py-1 text-xs font-medium text-white transition hover:bg-brand-hover"
                  >
                    Fix
                  </button>
                  <button
                    onClick={() => void ignoreItem(item.id)}
                    className="rounded-md border border-border-default px-3 py-1 text-xs font-medium text-text-muted transition hover:bg-surface-300"
                  >
                    Ignore
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
