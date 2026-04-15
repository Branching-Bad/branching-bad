import { useState } from "react";
import type { ProviderMeta } from "../types";
import { getAllProviderUIs } from "../providers/registry";
import { IconSettings } from "../components/icons";
import { ProviderSettingsModal } from "../components/ProviderSettingsModal";
import { McpTab } from "../mcp/McpTab";
import { ViewShell } from "./ViewShell";

export function ExtensionsView({
  selectedRepoId,
  providerMetas,
  providerItemCounts,
  busy,
  error,
  info,
  onBusyChange,
  onTasksRefresh,
  onError,
  onInfo,
  onBootstrapRefresh,
}: {
  selectedRepoId: string;
  providerMetas: ProviderMeta[];
  providerItemCounts: Record<string, number>;
  busy: boolean;
  error: string;
  info: string;
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
      <ViewShell title="Extensions" subtitle={`${providers.length} provider${providers.length === 1 ? "" : "s"}`}>
        <div className="space-y-3">
          <div className="overflow-hidden rounded-[var(--radius-lg)] border border-border-default bg-surface-0/40 p-3">
            <McpTab />
          </div>

          {(error || info) && (
            <div className="space-y-2">
              {error && (
                <div className="rounded-[var(--radius-md)] border border-error-border bg-error-bg px-3 py-2 text-sm text-error-text">{error}</div>
              )}
              {info && (
                <div className="rounded-[var(--radius-md)] border border-info-border bg-info-bg px-3 py-2 text-sm text-info-text">{info}</div>
              )}
            </div>
          )}

          {providers.map(([id, ui]) => {
            const meta = providerMetas.find((m) => m.id === id);
            const displayName = meta?.displayName ?? id;
            const count = providerItemCounts[id] ?? 0;
            const isExpanded = expanded[id] ?? false;
            const Section = ui.drawerSection;

            return (
              <div
                key={id}
                className="overflow-hidden rounded-[var(--radius-lg)] border border-border-default bg-surface-0/40 transition hover:border-border-strong"
              >
                <div
                  role="button"
                  tabIndex={0}
                  onClick={() => setExpanded((prev) => ({ ...prev, [id]: !isExpanded }))}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      setExpanded((prev) => ({ ...prev, [id]: !isExpanded }));
                    }
                  }}
                  className="group flex cursor-pointer items-center gap-2 px-3 py-2.5 transition hover:bg-surface-200"
                >
                  <svg
                    className={`h-3 w-3 shrink-0 text-text-muted transition-transform ${isExpanded ? "rotate-90" : ""}`}
                    viewBox="0 0 12 12"
                    fill="none"
                  >
                    <path d="M4.5 3L8 6L4.5 9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                  </svg>
                  <span className="flex-1 truncate text-[13px] font-medium text-text-primary">{displayName}</span>
                  {count > 0 && (
                    <span className="inline-flex h-5 min-w-[20px] items-center justify-center rounded-full bg-status-danger px-1.5 text-[10px] font-semibold text-white ring-2 ring-surface-100">
                      {count}
                    </span>
                  )}
                  <button
                    onClick={(e) => { e.stopPropagation(); setSettingsProviderId(id); }}
                    title={`${displayName} settings`}
                    className="flex h-6 w-6 items-center justify-center rounded-full text-text-muted opacity-0 transition hover:bg-surface-300 hover:text-text-primary group-hover:opacity-100"
                  >
                    <IconSettings className="h-3 w-3" />
                  </button>
                </div>

                {isExpanded && (
                  <div className="border-t border-border-default/60 bg-surface-100/50 px-3 py-3">
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
            <div className="flex items-center justify-center rounded-[var(--radius-lg)] border border-dashed border-border-default/60 px-4 py-10 text-center text-[12px] text-text-muted">
              No extensions registered.
            </div>
          )}
        </div>
      </ViewShell>

      {settingsProviderId && (
        <ProviderSettingsModal
          providerId={settingsProviderId}
          providerMetas={providerMetas}
          selectedRepoId={selectedRepoId}
          busy={busy}
          error={error}
          info={info}
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
