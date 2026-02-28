import { useState, useEffect, useCallback } from "react";
import { api } from "../api";
import type { ProviderMeta, ProviderAccount, ProviderResource } from "../types";
import { inputClass, selectClass, btnPrimary, btnSecondary } from "../components/shared";
import type { SettingsTabProps } from "./types";

/**
 * Generic, self-contained provider settings tab.
 * Fetches its own accounts/resources, handles connect/bind internally.
 * Pass `providerId` to create a concrete settings tab for a specific provider.
 */
export function createProviderSettingsTab(providerId: string) {
  return function ProviderSettingsTab({ selectedRepoId, busy, onBusyChange, onError, onInfo, onBootstrapRefresh }: SettingsTabProps) {
    const [meta, setMeta] = useState<ProviderMeta | null>(null);
    const [accounts, setAccounts] = useState<ProviderAccount[]>([]);
    const [resources, setResources] = useState<ProviderResource[]>([]);
    const [selectedAccountId, setSelectedAccountId] = useState("");
    const [selectedResourceId, setSelectedResourceId] = useState("");
    const [formValues, setFormValues] = useState<Record<string, string>>({});

    const fetchMeta = useCallback(async () => {
      try {
        const payload = await api<{
          providers?: ProviderMeta[];
          providerAccounts?: Record<string, ProviderAccount[]>;
        }>("/api/bootstrap");
        const providerMeta = payload.providers?.find((m) => m.id === providerId) ?? null;
        setMeta(providerMeta);
        setAccounts(payload.providerAccounts?.[providerId] ?? []);
      } catch { /* silent */ }
    }, []);

    useEffect(() => { void fetchMeta(); }, [fetchMeta]);

    async function handleConnect() {
      if (!meta) return;
      onError(""); onInfo(""); onBusyChange(true);
      try {
        await api(`/api/providers/${providerId}/connect`, { method: "POST", body: JSON.stringify(formValues) });
        onInfo(`${meta.display_name} connected.`);
        setFormValues({});
        await fetchMeta();
        onBootstrapRefresh();
      } catch (e) { onError((e as Error).message); } finally { onBusyChange(false); }
    }

    async function handleFetchResources() {
      if (!selectedAccountId) return;
      onError(""); onBusyChange(true);
      try {
        const payload = await api<{ resources: ProviderResource[] }>(`/api/providers/${providerId}/accounts/${selectedAccountId}/resources`);
        setResources(payload.resources);
      } catch (e) { onError((e as Error).message); } finally { onBusyChange(false); }
    }

    async function handleBind() {
      if (!selectedRepoId || !selectedAccountId || !selectedResourceId) {
        onError("Repo, account, and resource selection required.");
        return;
      }
      onError(""); onInfo(""); onBusyChange(true);
      try {
        await api(`/api/providers/${providerId}/bind`, {
          method: "POST",
          body: JSON.stringify({ repoId: selectedRepoId, accountId: selectedAccountId, resourceId: selectedResourceId }),
        });
        onInfo("Binding saved.");
      } catch (e) { onError((e as Error).message); } finally { onBusyChange(false); }
    }

    if (!meta) return <p className="text-sm text-text-muted">Loading…</p>;

    return (
      <div className="space-y-4">
        <div className="rounded-xl border border-border-default bg-surface-200 p-4">
          <h3 className="mb-3 text-sm font-medium text-text-secondary">Connect {meta.display_name}</h3>
          <form onSubmit={(e) => { e.preventDefault(); void handleConnect(); }} className="space-y-3">
            {meta.connect_fields.map((field) => (
              <input
                key={field.key}
                className={inputClass}
                placeholder={field.placeholder}
                type={field.field_type === "password" ? "password" : "text"}
                value={formValues[field.key] ?? ""}
                onChange={(e) => setFormValues((prev) => ({ ...prev, [field.key]: e.target.value }))}
              />
            ))}
            <button type="submit" disabled={busy} className={btnPrimary}>Connect</button>
          </form>
        </div>
        <div>
          <label className="mb-1.5 block text-xs font-medium text-text-muted uppercase tracking-wide">Account</label>
          <select className={selectClass} value={selectedAccountId} onChange={(e) => setSelectedAccountId(e.target.value)}>
            <option value="">Select account</option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>{a.displayName}</option>
            ))}
          </select>
        </div>
        <button onClick={() => void handleFetchResources()} disabled={busy || !selectedAccountId} className={btnSecondary}>
          Fetch {meta.resource_label}s
        </button>
        <div>
          <label className="mb-1.5 block text-xs font-medium text-text-muted uppercase tracking-wide">{meta.resource_label}</label>
          <select className={selectClass} value={selectedResourceId} onChange={(e) => setSelectedResourceId(e.target.value)}>
            <option value="">Select {meta.resource_label.toLowerCase()}</option>
            {resources.map((r) => (
              <option key={r.id} value={r.id}>{r.name}</option>
            ))}
          </select>
        </div>
        <button onClick={() => void handleBind()} disabled={busy || !selectedRepoId || !selectedAccountId || !selectedResourceId} className={btnPrimary}>
          Bind Repo to {meta.resource_label}
        </button>
      </div>
    );
  };
}
