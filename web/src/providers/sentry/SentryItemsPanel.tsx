import { useState, useEffect, useCallback } from "react";
import { api } from "../../api";
import type { ProviderItem } from "../../types";
import type { ItemsPanelProps } from "../types";

const PROVIDER_ID = "sentry";

export function SentryItemsPanel({ selectedRepoId, busy, onBusyChange, onTasksRefresh, onError, onInfo }: ItemsPanelProps) {
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
      await api(`/api/providers/${PROVIDER_ID}/sync/${selectedRepoId}`, { method: "POST" });
      await fetchItems();
      onInfo("Sentry sync complete.");
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
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-medium text-text-secondary">Sentry Issues</h3>
        <button onClick={() => void syncNow()} disabled={busy} className="rounded-md border border-border-default bg-surface-200 px-3 py-1 text-xs font-medium text-text-secondary transition hover:bg-surface-300">
          Sync Sentry
        </button>
      </div>
      {pending.length === 0 ? (
        <p className="text-sm text-text-muted">No pending issues.</p>
      ) : (
        <div className="space-y-2">
          {pending.map((item) => {
            const data = (() => { try { return JSON.parse(item.data_json); } catch { return {}; } })();
            return (
              <div key={item.id} className="flex items-start justify-between gap-3 rounded-xl border border-border-default bg-surface-200 p-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className={`inline-block h-2 w-2 rounded-full ${data.level === "fatal" ? "bg-red-600" : data.level === "error" ? "bg-red-400" : "bg-yellow-400"}`} />
                    <span className="truncate text-sm font-medium text-text-primary">{item.title}</span>
                    {item.status === "regression" && (
                      <span className="rounded bg-red-500/10 px-1.5 py-0.5 text-[10px] font-bold text-red-400 uppercase">Regression</span>
                    )}
                  </div>
                  <div className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-text-muted">
                    {data.culprit && <span>Culprit: {data.culprit}</span>}
                    {data.level && <span>Level: {data.level}</span>}
                    {data.occurrence_count && <span>Count: {data.occurrence_count}</span>}
                  </div>
                </div>
                <div className="flex shrink-0 gap-1.5">
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
