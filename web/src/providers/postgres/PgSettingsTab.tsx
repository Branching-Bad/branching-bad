import { useState, useEffect, useCallback } from "react";
import { api } from "../../api";
import type { ProviderAccount, ProviderResource } from "../../types";
import { inputClass, selectClass, btnPrimary, btnSecondary } from "../../components/shared";
import type { SettingsTabProps } from "../types";

const PROVIDER_ID = "postgres";

type ConnMode = "connection_string" | "fields";

export function PgSettingsTab({ selectedRepoId, busy, onBusyChange, onError, onInfo, onBootstrapRefresh }: SettingsTabProps) {
  const [accounts, setAccounts] = useState<ProviderAccount[]>([]);
  const [resources, setResources] = useState<ProviderResource[]>([]);
  const [selectedAccountId, setSelectedAccountId] = useState("");
  const [selectedResourceId, setSelectedResourceId] = useState("");

  const [mode, setMode] = useState<ConnMode>("connection_string");
  const [connString, setConnString] = useState("");
  const [host, setHost] = useState("");
  const [port, setPort] = useState("5432");
  const [dbname, setDbname] = useState("");
  const [user, setUser] = useState("");
  const [password, setPassword] = useState("");

  const fetchAccounts = useCallback(async () => {
    try {
      const payload = await api<{
        providerAccounts?: Record<string, ProviderAccount[]>;
      }>("/api/bootstrap");
      setAccounts(payload.providerAccounts?.[PROVIDER_ID] ?? []);
    } catch { /* silent */ }
  }, []);

  useEffect(() => { void fetchAccounts(); }, [fetchAccounts]);

  async function handleConnect() {
    onError(""); onInfo(""); onBusyChange(true);
    try {
      const body = mode === "connection_string"
        ? { connection_string: connString }
        : { host, port, dbname, user, password };
      await api(`/api/providers/${PROVIDER_ID}/connect`, { method: "POST", body: JSON.stringify(body) });
      onInfo("PostgreSQL connected.");
      setConnString(""); setHost(""); setPort("5432"); setDbname(""); setUser(""); setPassword("");
      await fetchAccounts();
      onBootstrapRefresh();
    } catch (e) { onError((e as Error).message); } finally { onBusyChange(false); }
  }

  async function handleFetchResources() {
    if (!selectedAccountId) return;
    onError(""); onBusyChange(true);
    try {
      const payload = await api<{ resources: ProviderResource[] }>(`/api/providers/${PROVIDER_ID}/accounts/${selectedAccountId}/resources`);
      setResources(payload.resources);
    } catch (e) { onError((e as Error).message); } finally { onBusyChange(false); }
  }

  async function handleBind() {
    if (!selectedRepoId || !selectedAccountId || !selectedResourceId) {
      onError("Repo, account, and database selection required.");
      return;
    }
    onError(""); onInfo(""); onBusyChange(true);
    try {
      await api(`/api/providers/${PROVIDER_ID}/bind`, {
        method: "POST",
        body: JSON.stringify({ repoId: selectedRepoId, accountId: selectedAccountId, resourceId: selectedResourceId }),
      });
      onInfo("Binding saved.");
    } catch (e) { onError((e as Error).message); } finally { onBusyChange(false); }
  }

  const modeBtn = (m: ConnMode, label: string) => (
    <button
      type="button"
      onClick={() => setMode(m)}
      className={`flex-1 rounded-md px-3 py-1.5 text-xs font-medium transition ${
        mode === m
          ? "bg-surface-100 text-text-primary shadow-sm"
          : "text-text-muted hover:text-text-secondary"
      }`}
    >
      {label}
    </button>
  );

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-border-default bg-surface-200 p-4">
        <h3 className="mb-3 text-sm font-medium text-text-secondary">Connect PostgreSQL</h3>

        {/* Mode toggle */}
        <div className="mb-3 flex gap-1 rounded-lg bg-surface-300 p-1">
          {modeBtn("connection_string", "Connection String")}
          {modeBtn("fields", "Individual Fields")}
        </div>

        <form onSubmit={(e) => { e.preventDefault(); void handleConnect(); }} className="space-y-3">
          {mode === "connection_string" ? (
            <input
              className={inputClass}
              type="password"
              placeholder="postgresql://user:pass@host:5432/dbname or Host=...;Port=...;Database=..."
              value={connString}
              onChange={(e) => setConnString(e.target.value)}
            />
          ) : (
            <>
              <input className={inputClass} placeholder="Host (localhost)" value={host} onChange={(e) => setHost(e.target.value)} />
              <input className={inputClass} placeholder="Port (5432)" value={port} onChange={(e) => setPort(e.target.value)} />
              <input className={inputClass} placeholder="Database" value={dbname} onChange={(e) => setDbname(e.target.value)} />
              <input className={inputClass} placeholder="User (postgres)" value={user} onChange={(e) => setUser(e.target.value)} />
              <input className={inputClass} type="password" placeholder="Password" value={password} onChange={(e) => setPassword(e.target.value)} />
            </>
          )}
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
        Fetch Databases
      </button>
      <div>
        <label className="mb-1.5 block text-xs font-medium text-text-muted uppercase tracking-wide">Database</label>
        <select className={selectClass} value={selectedResourceId} onChange={(e) => setSelectedResourceId(e.target.value)}>
          <option value="">Select database</option>
          {resources.map((r) => (
            <option key={r.id} value={r.id}>{r.name}</option>
          ))}
        </select>
      </div>
      <button onClick={() => void handleBind()} disabled={busy || !selectedRepoId || !selectedAccountId || !selectedResourceId} className={btnPrimary}>
        Bind Repo to Database
      </button>
    </div>
  );
}
