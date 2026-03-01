import { useState, useEffect, useCallback } from "react";
import { api } from "../../api";
import type { ProviderItem } from "../../types";
import type { DrawerSectionProps } from "../types";
import { SqIssuesModal } from "./SqIssuesModal";

const PROVIDER_ID = "sonarqube";

export type SonarScan = {
  id: string;
  status: string;
  issues_found: number | null;
  error: string | null;
  project_key: string;
  created_at: string;
};

export function SqDrawerSection({ selectedRepoId, busy, onBusyChange, onTasksRefresh, onError, onInfo }: DrawerSectionProps) {
  const [items, setItems] = useState<ProviderItem[]>([]);
  const [modalOpen, setModalOpen] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [activeScanId, setActiveScanId] = useState<string | null>(null);
  const [dockerAvailable, setDockerAvailable] = useState<boolean | null>(null);

  useEffect(() => {
    api<{ available: boolean }>("/api/sonarqube/docker-status")
      .then((res) => setDockerAvailable(res.available))
      .catch(() => setDockerAvailable(false));
  }, []);

  const fetchItems = useCallback(async () => {
    if (!selectedRepoId) return;
    try {
      const payload = await api<{ items: ProviderItem[] }>(`/api/providers/${PROVIDER_ID}/items/${selectedRepoId}`);
      setItems(payload.items);
    } catch { /* silent */ }
  }, [selectedRepoId]);

  useEffect(() => {
    if (selectedRepoId) void fetchItems();
  }, [selectedRepoId, fetchItems]);

  // Poll scan status
  useEffect(() => {
    if (!activeScanId) return;
    const interval = setInterval(async () => {
      try {
        const result = await api<{ scan: SonarScan }>(`/api/sonarqube/scans/${activeScanId}`);
        if (result.scan.status === "completed") {
          setScanning(false);
          setActiveScanId(null);
          void fetchItems();
          onInfo(`Scan complete. ${result.scan.issues_found ?? 0} issue(s) found.`);
        } else if (result.scan.status === "failed") {
          setScanning(false);
          setActiveScanId(null);
          onError(result.scan.error ?? "Scan failed");
        }
      } catch { /* silent */ }
    }, 3000);
    return () => clearInterval(interval);
  }, [activeScanId, fetchItems, onError, onInfo]);

  async function findBindingByMode(mode: "local" | "online") {
    if (!selectedRepoId) return null;
    try {
      const [bindingsRes, bootstrapRes] = await Promise.all([
        api<{ bindings: Array<{ provider_account_id: string; provider_resource_id: string; provider_id: string }> }>(
          `/api/providers/${PROVIDER_ID}/bindings?repoId=${selectedRepoId}`
        ),
        api<{ providerAccounts?: Record<string, Array<{ id: string; config?: Record<string, unknown> }>> }>("/api/bootstrap"),
      ]);

      const sqBindings = bindingsRes.bindings.filter(b => b.provider_id === PROVIDER_ID);
      const sqAccounts = bootstrapRes.providerAccounts?.[PROVIDER_ID] ?? [];

      // Try to find a binding whose account has the matching mode
      for (const binding of sqBindings) {
        const account = sqAccounts.find(a => a.id === binding.provider_account_id);
        if (account?.config?.mode === mode) return binding;
      }
      // Fallback: return first binding
      return sqBindings[0] ?? null;
    } catch {
      return null;
    }
  }

  async function startScan() {
    if (!selectedRepoId) return;
    onError(""); onBusyChange(true); setScanning(true);
    try {
      const binding = await findBindingByMode("local");
      if (!binding) {
        onError("No SonarQube project bound. Connect and bind a project first.");
        setScanning(false); onBusyChange(false);
        return;
      }

      // Get the resource to find the project key
      const resources = await api<{ resources: Array<{ id: string; external_id: string }> }>(
        `/api/providers/${PROVIDER_ID}/accounts/${binding.provider_account_id}/resources`
      );
      const resource = resources.resources.find(r => r.id === binding.provider_resource_id);
      if (!resource) {
        onError("Bound resource not found.");
        setScanning(false); onBusyChange(false);
        return;
      }

      const result = await api<{ id: string; status: string }>("/api/sonarqube/scan", {
        method: "POST",
        body: JSON.stringify({
          repoId: selectedRepoId,
          accountId: binding.provider_account_id,
          projectKey: resource.external_id,
          resourceId: binding.provider_resource_id,
        }),
      });
      setActiveScanId(result.id);
    } catch (e) {
      onError((e as Error).message);
      setScanning(false);
    } finally {
      onBusyChange(false);
    }
  }

  async function syncOnline() {
    if (!selectedRepoId) return;
    onError(""); onBusyChange(true);
    try {
      const result = await api<{ synced: number; errors?: string[] }>(`/api/providers/${PROVIDER_ID}/sync/${selectedRepoId}`, { method: "POST" });
      await fetchItems();
      if (result.errors?.length) {
        onError(`Sync issues: ${result.errors.join("; ")}`);
      } else {
        onInfo(`SonarQube sync complete. ${result.synced} issue(s) found.`);
      }
    } catch (e) { onError((e as Error).message); } finally { onBusyChange(false); }
  }

  const pending = items.filter((i) => i.status === "pending");

  return (
    <div>
      <div className="flex gap-2 mb-3">
        <button
          onClick={() => void syncOnline()}
          disabled={busy || scanning}
          className="flex-1 flex items-center justify-center gap-2 rounded-lg border border-border-default bg-surface-200 px-3 py-2 text-xs font-medium text-text-secondary transition hover:bg-surface-300 disabled:opacity-50"
        >
          Sync
        </button>
        <button
          onClick={() => void startScan()}
          disabled={busy || scanning || dockerAvailable === false}
          className="flex-1 flex items-center justify-center gap-2 rounded-lg border border-border-default bg-surface-200 px-3 py-2 text-xs font-medium text-text-secondary transition hover:bg-surface-300 disabled:opacity-50"
          title={dockerAvailable === false ? "Docker not available" : undefined}
        >
          {scanning ? "Scanning..." : "Scan (Docker)"}
        </button>
      </div>
      {dockerAvailable === false && (
        <p className="mb-2 -mt-1 text-[10px] text-yellow-400">Docker not available</p>
      )}
      {pending.length === 0 ? (
        <p className="text-xs text-text-muted">No issues detected.</p>
      ) : (
        <button
          onClick={() => setModalOpen(true)}
          className="w-full rounded-lg border border-brand/30 bg-brand/5 px-3 py-2.5 text-left text-xs font-medium text-brand transition hover:bg-brand/10"
        >
          {pending.length} issue{pending.length !== 1 ? "s" : ""} — View All
        </button>
      )}
      <SqIssuesModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        items={items}
        setItems={setItems}
        busy={busy}
        onBusyChange={onBusyChange}
        onTasksRefresh={onTasksRefresh}
        onError={onError}
        onInfo={onInfo}
        selectedRepoId={selectedRepoId}
      />
    </div>
  );
}
