import { useState } from "react";
import type { ProviderMeta } from "../types";
import { getProviderUI } from "./registry";

export function ProviderItemsPanel({
  selectedRepoId,
  providerMetas,
  providerItemCounts,
  onTasksRefresh,
  onError,
  onInfo,
  busy,
  setBusy,
}: {
  selectedRepoId: string;
  providerMetas: ProviderMeta[];
  providerItemCounts: Record<string, number>;
  onTasksRefresh: () => void;
  onError: (msg: string) => void;
  onInfo: (msg: string) => void;
  busy: boolean;
  setBusy: (v: boolean) => void;
}) {
  const [showItemsPanel, setShowItemsPanel] = useState(false);

  // Collect providers that have registered an itemsPanel via the registry
  const panelProviders = providerMetas
    .filter((m) => m.has_items_panel && getProviderUI(m.id)?.itemsPanel)
    .map((m) => ({ meta: m, Panel: getProviderUI(m.id)!.itemsPanel! }));

  const totalCount = Object.values(providerItemCounts).reduce((a, b) => a + b, 0);
  if (totalCount === 0 || panelProviders.length === 0) return null;

  return (
    <>
      <div className="mb-4">
        <button
          onClick={() => setShowItemsPanel(!showItemsPanel)}
          className="flex items-center gap-2 rounded-lg border border-border-default bg-surface-100 px-4 py-2 text-sm font-medium text-text-secondary transition hover:bg-surface-200"
        >
          Provider Items
          {totalCount > 0 && (
            <span className="inline-flex h-5 min-w-[20px] items-center justify-center rounded-full bg-red-500 px-1.5 text-[11px] font-bold text-white">
              {totalCount}
            </span>
          )}
        </button>
      </div>

      {showItemsPanel && (
        <section className="mb-6 rounded-2xl border border-border-default bg-surface-100 p-4 space-y-4">
          {panelProviders.map(({ meta, Panel }) => (
            <Panel
              key={meta.id}
              selectedRepoId={selectedRepoId}
              busy={busy}
              onBusyChange={setBusy}
              onTasksRefresh={onTasksRefresh}
              onError={onError}
              onInfo={onInfo}
            />
          ))}
        </section>
      )}
    </>
  );
}
