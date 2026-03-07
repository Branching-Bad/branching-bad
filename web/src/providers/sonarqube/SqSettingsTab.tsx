import { useState, useEffect, useCallback, useRef } from "react";
import { api } from "../../api";
import type { ProviderMeta, ProviderAccount, ProviderResource } from "../../types";
import { inputClass, selectClass, btnPrimary, btnSecondary } from "../../components/shared";
import type { SettingsTabProps } from "../types";
import { SqScanConfigPanel } from "./SqScanConfigPanel";

const PROVIDER_ID = "sonarqube";

type SqMode = "online" | "local";

type Binding = {
  provider_account_id: string;
  provider_resource_id: string;
  provider_id: string;
};

type SetupStatus = {
  status: "starting" | "waiting" | "configuring" | "completed" | "failed";
  result: { base_url: string; token: string } | null;
  error: string | null;
};

type LocalStatusRes = {
  container: "running" | "exited" | "not_found" | string;
  ready: boolean;
};

export function SqSettingsTab({ selectedRepoId, busy, onBusyChange, onError, onInfo, onBootstrapRefresh }: SettingsTabProps) {
  const [meta, setMeta] = useState<ProviderMeta | null>(null);
  const [accounts, setAccounts] = useState<ProviderAccount[]>([]);
  const [resources, setResources] = useState<ProviderResource[]>([]);
  const [selectedAccountId, setSelectedAccountId] = useState("");
  const [selectedResourceId, setSelectedResourceId] = useState("");
  const [formValues, setFormValues] = useState<Record<string, string>>({});
  const [sqMode, setSqMode] = useState<SqMode>("online");
  const [dockerAvailable, setDockerAvailable] = useState<boolean | null>(null);
  const [dockerChecking, setDockerChecking] = useState(false);
  const initDone = useRef(false);

  // Local setup state
  const [localPort, setLocalPort] = useState("9000");
  const [localUser, setLocalUser] = useState("admin");
  const [localPass, setLocalPass] = useState("admin");
  const [setupRunning, setSetupRunning] = useState(false);
  const [setupStatus, setSetupStatus] = useState<string | null>(null);
  const [localContainer, setLocalContainer] = useState<string | null>(null);

  const checkDocker = useCallback(async () => {
    setDockerChecking(true);
    try {
      const res = await api<{ available: boolean }>("/api/sonarqube/docker-status");
      setDockerAvailable(res.available);
    } catch {
      setDockerAvailable(false);
    } finally {
      setDockerChecking(false);
    }
  }, []);

  const checkLocalStatus = useCallback(async () => {
    try {
      const res = await api<LocalStatusRes>("/api/sonarqube/local-status");
      setLocalContainer(res.container);
    } catch {
      setLocalContainer(null);
    }
  }, []);

  useEffect(() => {
    void checkDocker();
    void checkLocalStatus();
  }, [checkDocker, checkLocalStatus]);

  const loadInitial = useCallback(async () => {
    try {
      const payload = await api<{
        providers?: ProviderMeta[];
        providerAccounts?: Record<string, ProviderAccount[]>;
      }>("/api/bootstrap");
      const providerMeta = payload.providers?.find((m) => m.id === PROVIDER_ID) ?? null;
      setMeta(providerMeta);
      const accts = payload.providerAccounts?.[PROVIDER_ID] ?? [];
      setAccounts(accts);

      let binding: Binding | null = null;
      let storedResources: ProviderResource[] = [];
      if (selectedRepoId) {
        try {
          const bindPayload = await api<{ bindings: Binding[]; resources: ProviderResource[] }>(
            `/api/providers/${PROVIDER_ID}/bindings?repo_id=${selectedRepoId}`
          );
          binding = bindPayload.bindings[0] ?? null;
          storedResources = bindPayload.resources ?? [];
        } catch { /* silent */ }
      }

      const accountId = binding?.provider_account_id ?? (accts.length === 1 ? accts[0].id : "");
      if (accountId) {
        setSelectedAccountId(accountId);
        const account = accts.find((a) => a.id === accountId);
        if (account) prefillForm(account);
        if (storedResources.length > 0) setResources(storedResources);
        if (binding?.provider_resource_id) setSelectedResourceId(binding.provider_resource_id);
      }

      initDone.current = true;
    } catch { /* silent */ }
  }, [selectedRepoId]);

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
  }, [selectedAccountId, accounts]);

  function prefillForm(account: ProviderAccount) {
    const cfg = account.config ?? {};
    const values: Record<string, string> = {};
    for (const [key, val] of Object.entries(cfg)) {
      values[key] = typeof val === "string" ? val : String(val ?? "");
    }
    setFormValues(values);
    if (values.mode === "local" || values.mode === "online") {
      setSqMode(values.mode as SqMode);
    }
  }

  async function handleConnect() {
    if (!meta) return;
    onError(""); onInfo(""); onBusyChange(true);
    try {
      const body = { ...formValues, mode: sqMode };
      await api(`/api/providers/${PROVIDER_ID}/connect`, { method: "POST", body: JSON.stringify(body) });
      onInfo(`${meta.displayName} connected.`);
      await loadInitial();
      onBootstrapRefresh();
    } catch (e) { onError((e as Error).message); } finally { onBusyChange(false); }
  }

  async function handleLocalSetup() {
    onError(""); onInfo("");
    setSetupRunning(true);
    setSetupStatus("Starting container...");

    try {
      const res = await api<{ jobId: string; status: string }>("/api/sonarqube/setup-local", {
        method: "POST",
        body: JSON.stringify({
          port: parseInt(localPort) || 9000,
          adminUser: localUser,
          adminPassword: localPass,
          repoId: selectedRepoId || undefined,
        }),
      });

      const jobId = res.jobId;

      // Poll for status
      const poll = setInterval(async () => {
        try {
          const s = await api<SetupStatus>(`/api/sonarqube/setup-status/${jobId}`);

          if (s.status === "waiting") {
            setSetupStatus("Waiting for SonarQube to start...");
          } else if (s.status === "configuring") {
            setSetupStatus("Configuring...");
          } else if (s.status === "completed" && s.result) {
            clearInterval(poll);
            setSetupStatus("Ready!");
            setSetupRunning(false);

            // Backend already created account + project + binding
            // Just refresh the UI state
            onInfo("Local SonarQube connected and project created.");
            await loadInitial();
            onBootstrapRefresh();
            void checkLocalStatus();

            setTimeout(() => setSetupStatus(null), 3000);
          } else if (s.status === "failed") {
            clearInterval(poll);
            setSetupStatus(null);
            setSetupRunning(false);
            onError(s.error ?? "Setup failed");
          }
        } catch {
          clearInterval(poll);
          setSetupRunning(false);
          setSetupStatus(null);
        }
      }, 3000);
    } catch (e) {
      onError((e as Error).message);
      setSetupRunning(false);
      setSetupStatus(null);
    }
  }

  async function handleDeleteAccount() {
    if (!selectedAccountId) return;
    onError(""); onInfo(""); onBusyChange(true);
    try {
      await api(`/api/providers/${PROVIDER_ID}/accounts/${selectedAccountId}`, { method: "DELETE" });
      onInfo("Account deleted.");
      setSelectedAccountId("");
      setFormValues({});
      setResources([]);
      setSelectedResourceId("");
      await loadInitial();
      onBootstrapRefresh();
    } catch (e) { onError((e as Error).message); } finally { onBusyChange(false); }
  }

  async function handleRefreshResources() {
    if (!selectedAccountId) return;
    onError(""); onBusyChange(true);
    try {
      const payload = await api<{ resources: ProviderResource[] }>(
        `/api/providers/${PROVIDER_ID}/accounts/${selectedAccountId}/resources`
      );
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
      await api(`/api/providers/${PROVIDER_ID}/bind`, {
        method: "POST",
        body: JSON.stringify({ repoId: selectedRepoId, accountId: selectedAccountId, resourceId: selectedResourceId }),
      });
      onInfo("Binding saved.");
    } catch (e) { onError((e as Error).message); } finally { onBusyChange(false); }
  }

  if (!meta) return <p className="text-sm text-text-muted">Loading…</p>;

  const connectFields = meta.connectFields.filter((f) => f.key !== "mode");
  const hasLocalAccount = accounts.some(a => a.config?.mode === "local");

  return (
    <div className="space-y-4">
      {/* Docker Status */}
      <div className={`rounded-xl border p-3 text-xs ${
        dockerAvailable === null
          ? "border-border-default bg-surface-200 text-text-muted"
          : dockerAvailable
            ? "border-green-700/40 bg-green-900/10 text-green-400"
            : "border-yellow-700/40 bg-yellow-900/10 text-yellow-400"
      }`}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            {dockerAvailable === null ? (
              <span className="text-text-muted">Checking Docker…</span>
            ) : dockerAvailable ? (
              <>
                <span className="inline-block h-2 w-2 rounded-full bg-green-400" />
                <span>Docker is running</span>
              </>
            ) : (
              <>
                <span className="inline-block h-2 w-2 rounded-full bg-yellow-400" />
                <span>Docker is not installed or not running. Install Docker Desktop to use local scanning.</span>
              </>
            )}
          </div>
          <button
            onClick={() => { void checkDocker(); void checkLocalStatus(); }}
            disabled={dockerChecking}
            className="rounded px-2 py-0.5 text-xs text-text-muted hover:text-text-secondary transition disabled:opacity-50"
          >
            {dockerChecking ? "…" : "↻"}
          </button>
        </div>
      </div>

      {/* Local Setup (Docker) */}
      {dockerAvailable && (
        <div className="rounded-xl border border-border-default bg-surface-200 p-4">
          <h3 className="mb-3 text-sm font-medium text-text-secondary">Local SonarQube (Docker)</h3>

          {localContainer === "running" && hasLocalAccount ? (
            <div className="flex items-center gap-2 text-xs text-green-400">
              <span className="inline-block h-2 w-2 rounded-full bg-green-400" />
              SonarQube running on localhost:{localPort}
            </div>
          ) : (
            <div className="space-y-3">
              <div>
                <label className="mb-1 block text-xs text-text-muted">Port</label>
                <input
                  className={inputClass}
                  type="number"
                  value={localPort}
                  onChange={(e) => setLocalPort(e.target.value)}
                  placeholder="9000"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs text-text-muted">Admin Username</label>
                <input
                  className={inputClass}
                  value={localUser}
                  onChange={(e) => setLocalUser(e.target.value)}
                  placeholder="admin"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs text-text-muted">Admin Password</label>
                <input
                  className={inputClass}
                  type="password"
                  value={localPass}
                  onChange={(e) => setLocalPass(e.target.value)}
                  placeholder="admin"
                />
              </div>
              <button
                onClick={() => void handleLocalSetup()}
                disabled={setupRunning || busy}
                className={btnPrimary}
              >
                {setupRunning ? "Setting up…" : "Start Local SonarQube"}
              </button>
              {setupStatus && (
                <p className="text-xs text-blue-400">{setupStatus}</p>
              )}
            </div>
          )}
        </div>
      )}

      {/* Account selector */}
      {accounts.length > 0 && (
        <div>
          <label className="mb-1.5 block text-xs font-medium text-text-muted uppercase tracking-wide">Account</label>
          <div className="flex gap-2">
            <select className={`${selectClass} flex-1`} value={selectedAccountId} onChange={(e) => setSelectedAccountId(e.target.value)}>
              <option value="">Select account</option>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.displayName}{a.config?.mode ? ` (${a.config.mode})` : ""}
                </option>
              ))}
            </select>
            {selectedAccountId && (
              <button
                onClick={() => void handleDeleteAccount()}
                disabled={busy}
                className="rounded-lg border border-red-700/40 bg-red-900/10 px-2.5 py-1.5 text-xs font-medium text-red-400 transition hover:bg-red-900/20 disabled:opacity-50"
                title="Delete account"
              >
                ✕
              </button>
            )}
          </div>
        </div>
      )}

      {/* Online Connect form */}
      <div className="rounded-xl border border-border-default bg-surface-200 p-4">
        <h3 className="mb-3 text-sm font-medium text-text-secondary">
          {selectedAccountId ? `Update ${meta.displayName}` : `Connect ${meta.displayName}`}
        </h3>
        <form onSubmit={(e) => { e.preventDefault(); void handleConnect(); }} className="space-y-3">
          {connectFields.map((field) => (
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

          {/* Mode toggle */}
          <div>
            <label className="mb-1.5 block text-xs text-text-muted">Mode</label>
            <div className="flex gap-1 rounded-lg bg-surface-300 p-1">
              <button
                type="button"
                onClick={() => setSqMode("online")}
                className={`flex-1 rounded-md px-3 py-1.5 text-xs font-medium transition ${
                  sqMode === "online"
                    ? "bg-surface-100 text-text-primary shadow-sm"
                    : "text-text-muted hover:text-text-secondary"
                }`}
              >
                Online
              </button>
              <button
                type="button"
                onClick={() => { if (dockerAvailable) setSqMode("local"); }}
                disabled={!dockerAvailable}
                className={`flex-1 rounded-md px-3 py-1.5 text-xs font-medium transition ${
                  sqMode === "local"
                    ? "bg-surface-100 text-text-primary shadow-sm"
                    : "text-text-muted hover:text-text-secondary"
                } disabled:opacity-40 disabled:cursor-not-allowed`}
              >
                Local (Docker)
              </button>
            </div>
            <p className="mt-1 text-[10px] text-text-muted">
              {sqMode === "online"
                ? "Sync issues from a remote SonarQube server."
                : "Scan the repo locally using Docker."}
            </p>
          </div>

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

      {/* Scan Configuration Panel — shown when binding exists */}
      {selectedRepoId && selectedAccountId && selectedResourceId && (
        <SqScanConfigPanel
          repoId={selectedRepoId}
          accountId={selectedAccountId}
          resourceId={selectedResourceId}
          busy={busy}
          onBusyChange={onBusyChange}
          onError={onError}
          onInfo={onInfo}
        />
      )}
    </div>
  );
}
