import { useState, useEffect, useCallback } from "react";
import { api } from "../../api";
import type { ProviderItem } from "../../types";
import type { DrawerSectionProps } from "../types";
import { SentryIssuesModal } from "./SentryIssuesModal";

const PROVIDER_ID = "sentry";

export function SentryDrawerSection({ selectedRepoId, busy, onBusyChange, onTasksRefresh, onError, onInfo }: DrawerSectionProps) {
  const [items, setItems] = useState<ProviderItem[]>([]);
  const [modalOpen, setModalOpen] = useState(false);

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
        <button
          onClick={() => setModalOpen(true)}
          className="w-full rounded-lg border border-brand/30 bg-brand/5 px-3 py-2.5 text-left text-xs font-medium text-brand transition hover:bg-brand/10"
        >
          {pending.length} new issue{pending.length !== 1 ? "s" : ""} — View All
        </button>
      )}
      <SentryIssuesModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        items={items}
        setItems={setItems}
        busy={busy}
        onBusyChange={onBusyChange}
        onTasksRefresh={onTasksRefresh}
        onError={onError}
        onInfo={onInfo}
        selectedRepoId={selectedRepoId}
      />
    </div>
  );
}
