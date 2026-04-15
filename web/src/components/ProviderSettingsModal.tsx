import type { ProviderMeta } from "../types";
import { getProviderUI } from "../providers/registry";
import { IconX } from "./icons";

export function ProviderSettingsModal({
  providerId,
  providerMetas,
  selectedRepoId,
  busy,
  error,
  info,
  onBusyChange,
  onError,
  onInfo,
  onBootstrapRefresh,
  onClose,
}: {
  providerId: string;
  providerMetas: ProviderMeta[];
  selectedRepoId: string;
  busy: boolean;
  error: string;
  info: string;
  onBusyChange: (v: boolean) => void;
  onError: (msg: string) => void;
  onInfo: (msg: string) => void;
  onBootstrapRefresh: () => void;
  onClose: () => void;
}) {
  const ui = getProviderUI(providerId);
  const meta = providerMetas.find((m) => m.id === providerId);
  if (!ui?.settingsTab) return null;
  const SettingsTab = ui.settingsTab;
  const displayName = meta?.displayName ?? providerId;

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-6">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />

      <div className="relative flex max-h-[85vh] w-full max-w-2xl flex-col overflow-hidden rounded-[var(--radius-2xl)] border border-border-default bg-surface-100 shadow-[var(--shadow-lg)]">
        {/* Header */}
        <header className="flex items-center justify-between gap-3 border-b border-border-default bg-surface-100/70 px-5 py-3.5 backdrop-blur-md">
          <div className="flex items-center gap-2">
            <span className="rounded-full bg-brand-tint px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.1em] text-brand">
              Extension
            </span>
            <h2 className="text-[14px] font-semibold text-text-primary">{displayName}</h2>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="flex h-7 w-7 items-center justify-center rounded-full text-text-muted transition hover:bg-surface-200 hover:text-text-primary"
          >
            <IconX className="h-3.5 w-3.5" />
          </button>
        </header>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4">
          {(error || info) && (
            <div className="mb-4 space-y-2">
              {error && (
                <div className="rounded-[var(--radius-md)] border border-error-border bg-error-bg px-3 py-2 text-sm text-error-text">
                  {error}
                </div>
              )}
              {info && (
                <div className="rounded-[var(--radius-md)] border border-info-border bg-info-bg px-3 py-2 text-sm text-info-text">
                  {info}
                </div>
              )}
            </div>
          )}
          <SettingsTab
            selectedRepoId={selectedRepoId}
            busy={busy}
            onBusyChange={onBusyChange}
            onError={onError}
            onInfo={onInfo}
            onBootstrapRefresh={onBootstrapRefresh}
          />
        </div>
      </div>
    </div>
  );
}
