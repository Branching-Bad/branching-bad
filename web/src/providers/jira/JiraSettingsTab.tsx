import { useState, useEffect, useCallback, useRef } from "react";
import { api } from "../../api";
import type { ProviderMeta, ProviderAccount, ProviderResource } from "../../types";
import { inputClass, selectClass, btnPrimary, btnSecondary } from "../../components/shared";
import type { SettingsTabProps } from "../types";

type Binding = {
  provider_account_id: string;
  provider_resource_id: string;
  provider_id: string;
};

export function JiraSettingsTab({
  selectedRepoId,
  busy,
  onBusyChange,
  onError,
  onInfo,
  onBootstrapRefresh,
}: SettingsTabProps) {
  const [meta, setMeta] = useState<ProviderMeta | null>(null);
  const [accounts, setAccounts] = useState<ProviderAccount[]>([]);
  const [resources, setResources] = useState<ProviderResource[]>([]);
  const [selectedAccountId, setSelectedAccountId] = useState("");
  const [selectedResourceId, setSelectedResourceId] = useState("");
  const [formValues, setFormValues] = useState<Record<string, string>>({});
  const initDone = useRef(false);

  const prefillForm = useCallback((account: ProviderAccount) => {
    const cfg = account.config ?? {};
    const values: Record<string, string> = {};
    for (const [key, val] of Object.entries(cfg)) {
      values[key] = typeof val === "string" ? val : String(val ?? "");
    }
    setFormValues(values);
  }, []);

  const loadInitial = useCallback(async () => {
    try {
      const payload = await api<{
        providers?: ProviderMeta[];
        providerAccounts?: Record<string, ProviderAccount[]>;
      }>("/api/bootstrap");
      const providerMeta = payload.providers?.find((m) => m.id === "jira") ?? null;
      setMeta(providerMeta);
      const accts = payload.providerAccounts?.jira ?? [];
      setAccounts(accts);

      let binding: Binding | null = null;
      let storedResources: ProviderResource[] = [];
      if (selectedRepoId) {
        try {
          const bindPayload = await api<{ bindings: Binding[]; resources: ProviderResource[] }>(
            `/api/providers/jira/bindings?repo_id=${selectedRepoId}`
          );
          binding = bindPayload.bindings[0] ?? null;
          storedResources = bindPayload.resources ?? [];
        } catch { /* silent */ }
      }

      const accountId = binding?.provider_account_id ?? (accts.length === 1 ? accts[0].id : "");
      if (!accountId) {
        setSelectedAccountId("");
        setSelectedResourceId("");
        setResources([]);
        initDone.current = true;
        return;
      }

      setSelectedAccountId(accountId);
      const account = accts.find((a) => a.id === accountId);
      if (account) prefillForm(account);

      if (storedResources.length > 0) {
        setResources(storedResources);
      }

      const resourceId = binding?.provider_resource_id ?? "";
      setSelectedResourceId(resourceId);

      initDone.current = true;
    } catch { /* silent */ }
  }, [prefillForm, selectedRepoId]);

  useEffect(() => { void loadInitial(); }, [loadInitial]);

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
  }, [accounts, prefillForm, selectedAccountId]);

  async function handleRefreshResources() {
    if (!selectedAccountId) return;
    onError(""); onBusyChange(true);
    try {
      const payload = await api<{ resources: ProviderResource[] }>(
        `/api/providers/jira/accounts/${selectedAccountId}/resources`
      );
      setResources(payload.resources);
      setSelectedResourceId("");
    } catch (e) {
      onError((e as Error).message);
    } finally {
      onBusyChange(false);
    }
  }

  async function handleConnect() {
    if (!meta) return;
    onError(""); onInfo(""); onBusyChange(true);
    try {
      await api("/api/providers/jira/connect", { method: "POST", body: JSON.stringify(formValues) });
      onInfo(`${meta.displayName} connected.`);
      await loadInitial();
      onBootstrapRefresh();
    } catch (e) {
      onError((e as Error).message);
    } finally {
      onBusyChange(false);
    }
  }

  async function handleBind() {
    if (!selectedRepoId || !selectedAccountId || !selectedResourceId) {
      onError("Repo, account, and board selection required.");
      return;
    }
    onError(""); onInfo(""); onBusyChange(true);
    try {
      await api("/api/providers/jira/bind", {
        method: "POST",
        body: JSON.stringify({
          repoId: selectedRepoId,
          accountId: selectedAccountId,
          resourceId: selectedResourceId,
          config: {},
        }),
      });
      onInfo("Board binding saved.");
    } catch (e) {
      onError((e as Error).message);
    } finally {
      onBusyChange(false);
    }
  }

  if (!meta) return <p className="text-sm text-text-muted">Loading...</p>;

  return (
    <div className="space-y-4">
      {accounts.length > 0 && (
        <div>
          <label className="mb-1.5 block text-xs font-medium text-text-muted uppercase tracking-wide">Account</label>
          <select className={selectClass} value={selectedAccountId} onChange={(e) => setSelectedAccountId(e.target.value)}>
            <option value="">Select account</option>
            {accounts.map((account) => (
              <option key={account.id} value={account.id}>{account.displayName}</option>
            ))}
          </select>
        </div>
      )}

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

      <div>
        <label className="mb-1.5 block text-xs font-medium text-text-muted uppercase tracking-wide">Board</label>
        <div className="flex gap-2">
          <select className={`${selectClass} flex-1`} value={selectedResourceId} onChange={(e) => setSelectedResourceId(e.target.value)}>
            <option value="">Select board</option>
            {resources.map((resource) => (
              <option key={resource.id} value={resource.id}>{resource.name}</option>
            ))}
          </select>
          <button onClick={() => void handleRefreshResources()} disabled={busy || !selectedAccountId} className={btnSecondary} title="Refresh boards">
            ↻
          </button>
        </div>
      </div>

      <button
        onClick={() => void handleBind()}
        disabled={busy || !selectedRepoId || !selectedAccountId || !selectedResourceId}
        className={btnPrimary}
      >
        Bind Repo to Board
      </button>
    </div>
  );
}
