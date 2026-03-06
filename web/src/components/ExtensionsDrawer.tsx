import { useState } from "react";
import type { ProviderMeta } from "../types";
import { getAllProviderUIs } from "../providers/registry";
import { IconX, IconSettings, IconChevronDown, IconChevronUp } from "./icons";
import { ProviderSettingsModal } from "./ProviderSettingsModal";

export function ExtensionsDrawer({
  open,
  onClose,
  selectedRepoId,
  providerMetas,
  providerItemCounts,
  busy,
  onBusyChange,
  onTasksRefresh,
  onError,
  onInfo,
  onBootstrapRefresh,
}: {
  open: boolean;
  onClose: () => void;
  selectedRepoId: string;
  providerMetas: ProviderMeta[];
  providerItemCounts: Record<string, number>;
  busy: boolean;
  onBusyChange: (v: boolean) => void;
  onTasksRefresh: () => void;
  onError: (msg: string) => void;
  onInfo: (msg: string) => void;
  onBootstrapRefresh: () => void;
}) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [settingsProviderId, setSettingsProviderId] = useState<string | null>(null);

  const providers = getAllProviderUIs();

  return (
    <>
      {/* Backdrop */}
      {open && (
        <div className="fixed inset-0 z-40 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      )}

      {/* Drawer */}
      <div
        className={`fixed top-0 right-0 z-50 flex h-full w-96 flex-col border-l border-border-default bg-surface-100 shadow-2xl transition-transform duration-300 ease-in-out ${
          open ? "translate-x-0" : "translate-x-full"
        }`}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border-default px-5 py-4">
          <h2 className="text-base font-medium text-text-primary">Extensions</h2>
          <button
            onClick={onClose}
            className="rounded-md p-1 text-text-muted transition hover:bg-surface-300 hover:text-text-primary"
          >
            <IconX className="h-5 w-5" />
          </button>
        </div>

        {/* Provider sections */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3">
          {providers.map(([id, ui]) => {
            const meta = providerMetas.find((m) => m.id === id);
            const displayName = meta?.displayName ?? id;
            const count = providerItemCounts[id] ?? 0;
            const isExpanded = expanded[id] ?? false;
            const Section = ui.drawerSection;

            return (
              <div key={id} className="rounded-xl border border-border-default bg-surface-50">
                {/* Section header */}
                <button
                  onClick={() => setExpanded((prev) => ({ ...prev, [id]: !isExpanded }))}
                  className="flex w-full items-center justify-between px-4 py-3 text-sm font-medium text-text-primary hover:bg-surface-200 rounded-t-xl transition"
                >
                  <div className="flex items-center gap-2">
                    {isExpanded ? <IconChevronUp className="h-3.5 w-3.5 text-text-muted" /> : <IconChevronDown className="h-3.5 w-3.5 text-text-muted" />}
                    <span>{displayName}</span>
                    {count > 0 && (
                      <span className="inline-flex h-5 min-w-[20px] items-center justify-center rounded-full bg-red-500 px-1.5 text-[10px] font-bold text-white">
                        {count}
                      </span>
                    )}
                  </div>
                  <button
                    onClick={(e) => { e.stopPropagation(); setSettingsProviderId(id); }}
                    className="rounded-md p-1 text-text-muted transition hover:bg-surface-300 hover:text-text-primary"
                    title={`${displayName} Settings`}
                  >
                    <IconSettings className="h-3.5 w-3.5" />
                  </button>
                </button>

                {/* Section content */}
                {isExpanded && (
                  <div className="border-t border-border-default px-4 py-3">
                    <Section
                      selectedRepoId={selectedRepoId}
                      busy={busy}
                      onBusyChange={onBusyChange}
                      onTasksRefresh={onTasksRefresh}
                      onError={onError}
                      onInfo={onInfo}
                    />
                  </div>
                )}
              </div>
            );
          })}

          {providers.length === 0 && (
            <p className="text-sm text-text-muted">No extensions registered.</p>
          )}
        </div>
      </div>

      {/* Provider settings modal (rendered on top of drawer) */}
      {settingsProviderId && (
        <ProviderSettingsModal
          providerId={settingsProviderId}
          providerMetas={providerMetas}
          selectedRepoId={selectedRepoId}
          busy={busy}
          onBusyChange={onBusyChange}
          onError={onError}
          onInfo={onInfo}
          onBootstrapRefresh={onBootstrapRefresh}
          onClose={() => setSettingsProviderId(null)}
        />
      )}
    </>
  );
}
