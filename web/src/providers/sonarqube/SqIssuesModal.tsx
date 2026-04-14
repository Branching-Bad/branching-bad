import { useState, useEffect, useMemo } from "react";
import { createPortal } from "react-dom";
import { api } from "../../api";
import { IconX, IconRefresh } from "../../components/icons";
import type { ProviderItem } from "../../types";
import type { SonarScan } from "./SqDrawerSection";

const PROVIDER_ID = "sonarqube";

type SeverityKey = "BLOCKER" | "CRITICAL" | "MAJOR" | "MINOR" | "INFO";

/* eslint-disable @typescript-eslint/no-explicit-any */
function parseData(item: ProviderItem): Record<string, any> {
  try { return JSON.parse(item.data_json); } catch { return {}; }
}
/* eslint-enable @typescript-eslint/no-explicit-any */

const SEVERITY_STYLES: Record<string, { dot: string; badge: string }> = {
  BLOCKER: { dot: "bg-status-danger", badge: "bg-status-danger text-white" },
  CRITICAL: { dot: "bg-status-danger", badge: "bg-status-danger text-white" },
  MAJOR: { dot: "bg-status-warning", badge: "bg-status-warning text-white" },
  MINOR: { dot: "bg-status-caution", badge: "bg-status-caution text-black" },
  INFO: { dot: "bg-status-neutral", badge: "bg-status-neutral text-white" },
};

const DEFAULT_STYLE = { dot: "bg-status-neutral", badge: "bg-status-neutral text-white" };

export function SqIssuesModal({
  open,
  onClose,
  items,
  setItems,
  busy,
  onBusyChange,
  onTasksRefresh,
  onError,
  onInfo,
  selectedRepoId,
}: {
  open: boolean;
  onClose: () => void;
  items: ProviderItem[];
  setItems: React.Dispatch<React.SetStateAction<ProviderItem[]>>;
  busy: boolean;
  onBusyChange: (v: boolean) => void;
  onTasksRefresh: () => void;
  onError: (msg: string) => void;
  onInfo: (msg: string) => void;
  selectedRepoId: string;
}) {
  const [severityFilter, setSeverityFilter] = useState<SeverityKey | "ALL">("ALL");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [scans, setScans] = useState<SonarScan[]>([]);
  const [showScans, setShowScans] = useState(false);

  useEffect(() => {
    if (open && selectedRepoId) {
      void api<{ scans: SonarScan[] }>(`/api/sonarqube/scans?repoId=${selectedRepoId}`)
        .then(r => setScans(r.scans.slice(0, 5)))
        .catch(() => {});
    }
  }, [open, selectedRepoId]);

  // Parse data once and compute severity counts in a single pass
  const { pending, severityCounts } = useMemo(() => {
    const p: Array<ProviderItem & { _parsed: Record<string, any> }> = []; // eslint-disable-line @typescript-eslint/no-explicit-any
    const counts: Record<string, number> = { BLOCKER: 0, CRITICAL: 0, MAJOR: 0, MINOR: 0, INFO: 0 };
    for (const item of items) {
      if (item.status !== "pending") continue;
      const data = parseData(item);
      const sev = (data.severity as string) || "MAJOR";
      if (sev in counts) counts[sev]++;
      p.push(Object.assign(item, { _parsed: data }));
    }
    return { pending: p, severityCounts: counts };
  }, [items]);

  const filtered = severityFilter === "ALL"
    ? pending
    : pending.filter(i => (i._parsed.severity || "MAJOR") === severityFilter);

  if (!open) return null;

  async function syncNow() {
    if (!selectedRepoId) return;
    onError(""); onBusyChange(true);
    try {
      const result = await api<{ synced: number; errors?: string[] }>(`/api/providers/${PROVIDER_ID}/sync/${selectedRepoId}`, { method: "POST" });
      const payload = await api<{ items: ProviderItem[] }>(`/api/providers/${PROVIDER_ID}/items/${selectedRepoId}`);
      setItems(payload.items);
      if (result.errors?.length) {
        onError(`Sync issues: ${result.errors.join("; ")}`);
      } else {
        onInfo(`SonarQube sync complete. ${result.synced} issue(s) found.`);
      }
    } catch (e) { onError((e as Error).message); } finally { onBusyChange(false); }
  }

  async function clearAll() {
    if (!selectedRepoId) return;
    onError(""); onBusyChange(true);
    try {
      await api(`/api/providers/${PROVIDER_ID}/items/clear/${selectedRepoId}`, { method: "POST" });
      setItems([]);
      setExpandedId(null);
      onInfo("All SonarQube items cleared.");
    } catch (e) { onError((e as Error).message); } finally { onBusyChange(false); }
  }

  async function createTask(itemId: string) {
    onError(""); onBusyChange(true);
    try {
      await api(`/api/providers/${PROVIDER_ID}/items/${itemId}/create-task`, { method: "POST" });
      setItems((prev) => prev.map((i) => i.id === itemId ? { ...i, status: "accepted" } : i));
      onTasksRefresh();
      onInfo("Task created from SonarQube issue.");
    } catch (e) { onError((e as Error).message); } finally { onBusyChange(false); }
  }

  async function ignoreItem(itemId: string) {
    try {
      await api(`/api/providers/${PROVIDER_ID}/items/${itemId}/action`, { method: "POST", body: JSON.stringify({ action: "ignore" }) });
      setItems((prev) => prev.map((i) => i.id === itemId ? { ...i, status: "ignored" } : i));
    } catch (e) { onError((e as Error).message); }
  }

  const severities: { key: SeverityKey | "ALL"; label: string; count: number }[] = [
    { key: "ALL", label: "All", count: pending.length },
    { key: "BLOCKER", label: "Blocker", count: severityCounts.BLOCKER },
    { key: "CRITICAL", label: "Critical", count: severityCounts.CRITICAL },
    { key: "MAJOR", label: "Major", count: severityCounts.MAJOR },
    { key: "MINOR", label: "Minor", count: severityCounts.MINOR },
    { key: "INFO", label: "Info", count: severityCounts.INFO },
  ];

  return createPortal(
    <div className="fixed inset-0 z-[70] flex items-center justify-center">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-[720px] rounded-2xl border border-border-default bg-surface-100 shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border-default px-6 py-4">
          <h3 className="text-base font-medium text-text-primary">SonarQube Issues</h3>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowScans(!showScans)}
              className="flex items-center gap-1.5 rounded-lg border border-border-default bg-surface-200 px-3 py-1.5 text-xs font-medium text-text-secondary transition hover:bg-surface-300"
            >
              Scans
            </button>
            <button
              onClick={() => void clearAll()}
              disabled={busy}
              className="flex items-center gap-1.5 rounded-lg border border-status-danger/30 bg-status-danger/5 px-3 py-1.5 text-xs font-medium text-status-danger transition hover:bg-status-danger/10 disabled:opacity-50"
            >
              Clear
            </button>
            <button
              onClick={() => void syncNow()}
              disabled={busy}
              className="flex items-center gap-1.5 rounded-lg border border-border-default bg-surface-200 px-3 py-1.5 text-xs font-medium text-text-secondary transition hover:bg-surface-300 disabled:opacity-50"
            >
              <IconRefresh className={`h-3.5 w-3.5 ${busy ? "animate-spin" : ""}`} />
              Sync
            </button>
            <button onClick={onClose} className="rounded-md p-1 text-text-muted transition hover:bg-surface-300 hover:text-text-primary">
              <IconX className="h-5 w-5" />
            </button>
          </div>
        </div>

        {/* Scan History */}
        {showScans && scans.length > 0 && (
          <div className="border-b border-border-default px-6 py-3 bg-surface-200/50">
            <p className="text-[11px] font-medium text-text-muted mb-2">Recent Scans</p>
            <div className="space-y-1">
              {scans.map(s => (
                <div key={s.id} className="flex items-center gap-3 text-[11px] text-text-secondary">
                  <span className={`inline-block h-1.5 w-1.5 rounded-full ${
                    s.status === "completed" ? "bg-status-success" : s.status === "failed" ? "bg-status-danger" : "bg-status-caution animate-pulse"
                  }`} />
                  <span className="font-mono">{s.project_key}</span>
                  <span className="text-text-muted">{s.status}</span>
                  {s.issues_found != null && <span>{s.issues_found} issues</span>}
                  <span className="text-text-muted ml-auto">{new Date(s.created_at).toLocaleString()}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Severity Filter Tabs */}
        <div className="flex border-b border-border-default px-6 overflow-x-auto">
          {severities.map((s) => (
            <button
              key={s.key}
              onClick={() => { setSeverityFilter(s.key); setExpandedId(null); }}
              className={`relative shrink-0 px-3 py-2.5 text-xs font-medium transition ${
                severityFilter === s.key
                  ? "text-text-primary after:absolute after:bottom-0 after:left-0 after:right-0 after:h-0.5 after:bg-brand"
                  : "text-text-muted hover:text-text-secondary"
              }`}
            >
              {s.label}
              <span className={`ml-1.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] font-bold ${
                severityFilter === s.key ? "bg-brand/15 text-brand" : "bg-surface-300 text-text-muted"
              }`}>
                {s.count}
              </span>
            </button>
          ))}
        </div>

        {/* Items */}
        <div className="max-h-[420px] overflow-y-auto px-6 py-4">
          {filtered.length === 0 ? (
            <p className="py-8 text-center text-xs text-text-muted">
              No {severityFilter === "ALL" ? "" : severityFilter.toLowerCase() + " "}issues detected.
            </p>
          ) : (
            <div className="space-y-2">
              {filtered.map((item) => {
                const data = item._parsed;
                const isExpanded = expandedId === item.id;
                const severity = (data.severity as string) || "MAJOR";
                const style = SEVERITY_STYLES[severity] ?? DEFAULT_STYLE;
                return (
                  <div key={item.id} className="rounded-xl border border-border-default bg-surface-200">
                    <button
                      type="button"
                      onClick={() => setExpandedId(isExpanded ? null : item.id)}
                      className="w-full p-3 text-left"
                    >
                      <div className="flex items-center gap-2">
                        <span className={`inline-block h-2 w-2 shrink-0 rounded-full ${style.dot}`} />
                        <span className="truncate text-xs font-medium text-text-primary">{data.message || item.title}</span>
                        <span className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-bold ${style.badge}`}>
                          {severity}
                        </span>
                        <svg className={`ml-auto h-3.5 w-3.5 shrink-0 text-text-muted transition-transform ${isExpanded ? "rotate-180" : ""}`} fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" d="m19.5 8.25-7.5 7.5-7.5-7.5" />
                        </svg>
                      </div>
                      <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-text-muted">
                        <span>{data.rule}</span>
                        <span>{data.type}</span>
                        {data.component && <span className="font-mono">{data.component}{data.line ? `:${data.line}` : ""}</span>}
                        {data.effort && <span>Effort: {data.effort}</span>}
                      </div>
                    </button>

                    {isExpanded && (
                      <div className="border-t border-border-default px-3 pb-3 pt-2">
                        <div className="mb-2">
                          <p className="mb-1 text-[11px] font-medium text-text-muted">Message</p>
                          <pre className="max-h-[160px] overflow-auto rounded-lg bg-surface-100 p-2.5 text-[11px] leading-relaxed text-text-secondary font-mono whitespace-pre-wrap">{data.message}</pre>
                        </div>

                        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-text-muted">
                          <span>Rule: <span className="text-text-secondary">{data.rule}</span></span>
                          <span>Type: <span className="text-text-secondary">{data.type}</span></span>
                          {data.component && <span>File: <span className="text-text-secondary font-mono">{data.component}</span></span>}
                          {data.line && <span>Line: <span className="text-text-secondary">{data.line}</span></span>}
                          {data.effort && <span>Effort: <span className="text-text-secondary">{data.effort}</span></span>}
                        </div>

                        <div className="mt-2.5 flex gap-1.5">
                          <button
                            onClick={() => void createTask(item.id)}
                            disabled={busy}
                            className="rounded-md bg-brand px-3 py-1 text-xs font-medium text-white transition hover:bg-brand-hover disabled:opacity-50"
                          >
                            Create Task
                          </button>
                          <button
                            onClick={() => void ignoreItem(item.id)}
                            className="rounded-md border border-border-default px-3 py-1 text-xs font-medium text-text-muted transition hover:bg-surface-300"
                          >
                            Ignore
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
