import { useState, useEffect, useCallback, useRef } from "react";
import { api } from "../api";
import type { ProviderMeta, ProviderAccount, ProviderResource } from "../types";
import { inputClass, selectClass, btnPrimary, btnSecondary } from "../components/shared";
import type { SettingsTabProps } from "./types";

type Binding = {
  provider_account_id: string;
  provider_resource_id: string;
  provider_id: string;
};

export function createProviderSettingsTab(providerId: string) {
  return function ProviderSettingsTab({ selectedRepoId, busy, onBusyChange, onError, onInfo, onBootstrapRefresh }: SettingsTabProps) {
    const [meta, setMeta] = useState<ProviderMeta | null>(null);
    const [accounts, setAccounts] = useState<ProviderAccount[]>([]);
    const [resources, setResources] = useState<ProviderResource[]>([]);
    const [selectedAccountId, setSelectedAccountId] = useState("");
    const [selectedResourceId, setSelectedResourceId] = useState("");
    const [formValues, setFormValues] = useState<Record<string, string>>({});
    const initDone = useRef(false);

    // Load accounts + bindings on mount, auto-select bound account/resource
    const loadInitial = useCallback(async () => {
      try {
        const payload = await api<{
          providers?: ProviderMeta[];
          providerAccounts?: Record<string, ProviderAccount[]>;
        }>("/api/bootstrap");
        const providerMeta = payload.providers?.find((m) => m.id === providerId) ?? null;
        setMeta(providerMeta);
        const accts = payload.providerAccounts?.[providerId] ?? [];
        setAccounts(accts);

        // Fetch existing binding + stored resources for this repo (no remote API call)
        let binding: Binding | null = null;
        let storedResources: ProviderResource[] = [];
        if (selectedRepoId) {
          try {
            const bindPayload = await api<{ bindings: Binding[]; resources: ProviderResource[] }>(
              `/api/providers/${providerId}/bindings?repo_id=${selectedRepoId}`
            );
            binding = bindPayload.bindings[0] ?? null;
            storedResources = bindPayload.resources ?? [];
          } catch { /* silent */ }
        }

        // Auto-select account: from binding or single account
        const accountId = binding?.provider_account_id ?? (accts.length === 1 ? accts[0].id : "");
        if (accountId) {
          setSelectedAccountId(accountId);
          const account = accts.find((a) => a.id === accountId);
          if (account) prefillForm(account);

          // Use stored resources (instant, no remote call)
          if (storedResources.length > 0) {
            setResources(storedResources);
          }
          if (binding?.provider_resource_id) {
            setSelectedResourceId(binding.provider_resource_id);
          }
        }

        initDone.current = true;
      } catch { /* silent */ }
    }, [selectedRepoId]);

    useEffect(() => { void loadInitial(); }, [loadInitial]);

    // When account selection changes manually (after init), pre-fill form
    useEffect(() => {
      if (!initDone.current) return;
      if (!selectedAccountId) {
        setFormValues({});
        setResources([]);
        setSelectedResourceId("");
        return;
      }
      const account = accounts.find((a) => a.id === selectedAccountId);
      if (account) prefillForm(account);
    }, [selectedAccountId]);

    function prefillForm(account: ProviderAccount) {
      const cfg = account.config ?? {};
      const values: Record<string, string> = {};
      for (const [key, val] of Object.entries(cfg)) {
        values[key] = typeof val === "string" ? val : String(val ?? "");
      }
      setFormValues(values);
    }

    async function handleRefreshResources() {
      if (!selectedAccountId) return;
      onError(""); onBusyChange(true);
      try {
        const payload = await api<{ resources: ProviderResource[] }>(
          `/api/providers/${providerId}/accounts/${selectedAccountId}/resources`
        );
        setResources(payload.resources);
      } catch (e) { onError((e as Error).message); } finally { onBusyChange(false); }
    }

    async function handleConnect() {
      if (!meta) return;
      onError(""); onInfo(""); onBusyChange(true);
      try {
        await api(`/api/providers/${providerId}/connect`, { method: "POST", body: JSON.stringify(formValues) });
        onInfo(`${meta.displayName} connected.`);
        await loadInitial();
        onBootstrapRefresh();
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
        {/* Account selector */}
        {accounts.length > 0 && (
          <div>
            <label className="mb-1.5 block text-xs font-medium text-text-muted uppercase tracking-wide">Account</label>
            <select className={selectClass} value={selectedAccountId} onChange={(e) => setSelectedAccountId(e.target.value)}>
              <option value="">Select account</option>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>{a.displayName}</option>
              ))}
            </select>
          </div>
        )}

        {/* Connect / Update form */}
        <div className="rounded-xl border border-border-default bg-surface-200 p-4">
          <h3 className="mb-3 text-sm font-medium text-text-secondary">
            {selectedAccountId ? `Update ${meta.displayName}` : `Connect ${meta.displayName}`}
          </h3>
          <form onSubmit={(e) => { e.preventDefault(); void handleConnect(); }} className="space-y-3">
            {meta.connectFields.map((field) => (
              <div key={field.key}>
                <label className="mb-1 block text-xs text-text-muted">{field.label}</label>
                <input
                  className={inputClass}
                  placeholder={field.placeholder}
                  type={field.fieldType === "password" ? "password" : "text"}
                  value={formValues[field.key] ?? ""}
                  onChange={(e) => setFormValues((prev) => ({ ...prev, [field.key]: e.target.value }))}
                />
              </div>
            ))}
            <button type="submit" disabled={busy} className={btnPrimary}>
              {selectedAccountId ? "Update" : "Connect"}
            </button>
          </form>
        </div>

        {/* Resource selector */}
        <div>
          <label className="mb-1.5 block text-xs font-medium text-text-muted uppercase tracking-wide">{meta.resourceLabel}</label>
          <div className="flex gap-2">
            <select className={`${selectClass} flex-1`} value={selectedResourceId} onChange={(e) => setSelectedResourceId(e.target.value)}>
              <option value="">Select {meta.resourceLabel.toLowerCase()}</option>
              {resources.map((r) => (
                <option key={r.id} value={r.id}>{r.name}</option>
              ))}
            </select>
            <button onClick={() => void handleRefreshResources()} disabled={busy || !selectedAccountId} className={btnSecondary} title={`Refresh ${meta.resourceLabel}s`}>
              ↻
            </button>
          </div>
        </div>
        <button onClick={() => void handleBind()} disabled={busy || !selectedRepoId || !selectedAccountId || !selectedResourceId} className={btnPrimary}>
          Bind Repo to {meta.resourceLabel}
        </button>
      </div>
    );
  };
}
