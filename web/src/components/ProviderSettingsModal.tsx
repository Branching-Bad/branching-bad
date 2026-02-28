import type { ProviderMeta } from "../types";
import { getProviderUI } from "../providers/registry";
import { IconX } from "./icons";

export function ProviderSettingsModal({
  providerId,
  providerMetas,
  selectedRepoId,
  busy,
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

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-[500px] rounded-2xl border border-border-default bg-surface-100 shadow-2xl">
        <div className="flex items-center justify-between border-b border-border-default px-6 py-4">
          <h2 className="text-base font-medium text-text-primary">{meta?.display_name ?? providerId} Settings</h2>
          <button onClick={onClose} className="rounded-md p-1 text-text-muted transition hover:bg-surface-300 hover:text-text-primary">
            <IconX className="h-5 w-5" />
          </button>
        </div>
        <div className="max-h-[420px] overflow-y-auto px-6 py-4">
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
