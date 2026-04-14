import { useState } from "react";
import { createPortal } from "react-dom";
import { api } from "../../api";
import { IconX, IconRefresh } from "../../components/icons";
import type { ProviderItem } from "../../types";

const PROVIDER_ID = "postgres";

type Tab = "slow_query" | "n_plus_one" | "missing_index" | "unused_index" | "vacuum_needed";

/* eslint-disable @typescript-eslint/no-explicit-any */
function parseData(item: ProviderItem): Record<string, any> {
  try { return JSON.parse(item.data_json); } catch { return {}; }
}
/* eslint-enable @typescript-eslint/no-explicit-any */

const SEVERITY_DOT: Record<string, string> = {
  critical: "bg-status-danger",
  high: "bg-status-warning",
  medium: "bg-status-caution",
  low: "bg-status-neutral",
};

function severityDot(severity: string) {
  return SEVERITY_DOT[severity] ?? "bg-status-neutral";
}

function fmtNum(n: number | undefined): string {
  if (n == null) return "—";
  return n.toLocaleString();
}

export function PgIssuesModal({
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
  selectedRepoId: string | null;
}) {
  const [tab, setTab] = useState<Tab>("slow_query");
  const [expandedId, setExpandedId] = useState<string | null>(null);

  if (!open) return null;

  // Categorize items
  const byCategory = (cat: string) =>
    items.filter((i) => {
      const d = parseData(i);
      return d.category === cat && i.status === "pending";
    });

  const slowQueries = byCategory("slow_query");
  const nPlusOne = byCategory("n_plus_one");
  const missingIndex = byCategory("missing_index");
  const unusedIndex = byCategory("unused_index");
  const vacuumNeeded = byCategory("vacuum_needed");

  const displayed: ProviderItem[] =
    tab === "slow_query" ? slowQueries
    : tab === "n_plus_one" ? nPlusOne
    : tab === "missing_index" ? missingIndex
    : tab === "unused_index" ? unusedIndex
    : vacuumNeeded;

  async function syncNow() {
    if (!selectedRepoId) return;
    onError(""); onBusyChange(true);
    try {
      const result = await api<{ synced: number; errors?: string[] }>(`/api/providers/${PROVIDER_ID}/sync/${selectedRepoId}`, { method: "POST" });
      const payload = await api<{ items: ProviderItem[] }>(`/api/providers/${PROVIDER_ID}/items/${selectedRepoId}`);
      setItems(payload.items);
      if (result.errors?.length) {
        onError(`Analysis issues: ${result.errors.join("; ")}`);
      } else {
        onInfo(`PostgreSQL analysis complete. ${result.synced} issue(s) found.`);
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
      onInfo("All PostgreSQL items cleared. Re-analyze to fetch fresh data.");
    } catch (e) { onError((e as Error).message); } finally { onBusyChange(false); }
  }

  async function createTask(itemId: string) {
    onError(""); onBusyChange(true);
    try {
      await api(`/api/providers/${PROVIDER_ID}/items/${itemId}/create-task`, { method: "POST" });
      setItems((prev) => prev.map((i) => i.id === itemId ? { ...i, status: "accepted" } : i));
      onTasksRefresh();
      onInfo("Task created from PostgreSQL performance issue.");
    } catch (e) { onError((e as Error).message); } finally { onBusyChange(false); }
  }

  async function ignoreItem(itemId: string) {
    try {
      await api(`/api/providers/${PROVIDER_ID}/items/${itemId}/action`, { method: "POST", body: JSON.stringify({ action: "ignore" }) });
      setItems((prev) => prev.map((i) => i.id === itemId ? { ...i, status: "ignored" } : i));
    } catch (e) { onError((e as Error).message); }
  }

  const tabs: { key: Tab; label: string; count: number }[] = [
    { key: "slow_query", label: "Slow Queries", count: slowQueries.length },
    { key: "n_plus_one", label: "N+1", count: nPlusOne.length },
    { key: "missing_index", label: "Missing Index", count: missingIndex.length },
    { key: "unused_index", label: "Unused Index", count: unusedIndex.length },
    { key: "vacuum_needed", label: "Vacuum", count: vacuumNeeded.length },
  ];

  return createPortal(
    <div className="fixed inset-0 z-[70] flex items-center justify-center">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-[720px] rounded-2xl border border-border-default bg-surface-100 shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border-default px-6 py-4">
          <h3 className="text-base font-medium text-text-primary">PostgreSQL Performance Issues</h3>
          <div className="flex items-center gap-2">
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
              Analyze
            </button>
            <button onClick={onClose} className="rounded-md p-1 text-text-muted transition hover:bg-surface-300 hover:text-text-primary">
              <IconX className="h-5 w-5" />
            </button>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-border-default px-6 overflow-x-auto">
          {tabs.map((t) => (
            <button
              key={t.key}
              onClick={() => { setTab(t.key); setExpandedId(null); }}
              className={`relative shrink-0 px-3 py-2.5 text-xs font-medium transition ${
                tab === t.key
                  ? "text-text-primary after:absolute after:bottom-0 after:left-0 after:right-0 after:h-0.5 after:bg-brand"
                  : "text-text-muted hover:text-text-secondary"
              }`}
            >
              {t.label}
              <span className={`ml-1.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] font-bold ${
                tab === t.key ? "bg-brand/15 text-brand" : "bg-surface-300 text-text-muted"
              }`}>
                {t.count}
              </span>
            </button>
          ))}
        </div>

        {/* Items */}
        <div className="max-h-[420px] overflow-y-auto px-6 py-4">
          {displayed.length === 0 ? (
            <p className="py-8 text-center text-xs text-text-muted">
              No {tabs.find((t) => t.key === tab)?.label.toLowerCase()} issues detected.
            </p>
          ) : (
            <div className="space-y-2">
              {displayed.map((item) => {
                const data = parseData(item);
                const isExpanded = expandedId === item.id;
                return (
                  <div key={item.id} className="rounded-xl border border-border-default bg-surface-200">
                    <button
                      type="button"
                      onClick={() => setExpandedId(isExpanded ? null : item.id)}
                      className="w-full p-3 text-left"
                    >
                      <div className="flex items-center gap-2">
                        <span className={`inline-block h-2 w-2 shrink-0 rounded-full ${severityDot(data.severity)}`} />
                        <span className="truncate text-xs font-medium text-text-primary">{item.title}</span>
                        <span className="shrink-0 rounded bg-surface-300 px-1.5 py-0.5 text-[10px] font-medium text-text-muted uppercase">{data.severity}</span>
                        <svg className={`ml-auto h-3.5 w-3.5 shrink-0 text-text-muted transition-transform ${isExpanded ? "rotate-180" : ""}`} fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" d="m19.5 8.25-7.5 7.5-7.5-7.5" />
                        </svg>
                      </div>
                      <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-text-muted">
                        <MetricChips data={data} category={tab} />
                      </div>
                    </button>

                    {isExpanded && (
                      <div className="border-t border-border-default px-3 pb-3 pt-2">
                        {/* Full query if present */}
                        {data.query && (
                          <div className="mb-2">
                            <p className="mb-1 text-[11px] font-medium text-text-muted">Query</p>
                            <pre className="max-h-[160px] overflow-auto rounded-lg bg-surface-100 p-2.5 text-[11px] leading-relaxed text-text-secondary font-mono">{data.query}</pre>
                          </div>
                        )}

                        {/* Recommendation */}
                        {data.recommendation && (
                          <div className="mb-2">
                            <p className="mb-1 text-[11px] font-medium text-text-muted">Recommendation</p>
                            <pre className="max-h-[200px] overflow-auto rounded-lg bg-surface-100 p-2.5 text-[11px] leading-relaxed text-text-secondary font-mono whitespace-pre-wrap">{data.recommendation}</pre>
                          </div>
                        )}

                        {/* Detailed metrics */}
                        <DetailMetrics data={data} category={tab} />

                        {/* Actions */}
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

/* eslint-disable @typescript-eslint/no-explicit-any */
function MetricChips({ data, category }: { data: Record<string, any>; category: string }) {
  switch (category) {
    case "slow_query":
      return (
        <>
          {data.mean_ms != null && <span>Mean: {data.mean_ms.toFixed(1)} ms</span>}
          {data.calls != null && <span>Calls: {fmtNum(data.calls)}</span>}
          {data.total_ms != null && <span>Total: {fmtNum(Math.round(data.total_ms))} ms</span>}
        </>
      );
    case "n_plus_one":
      return (
        <>
          {data.calls != null && <span>Calls: {fmtNum(data.calls)}</span>}
          {data.mean_ms != null && <span>Mean: {data.mean_ms.toFixed(1)} ms</span>}
        </>
      );
    case "missing_index":
      return (
        <>
          {data.schema_name && data.table_name && <span>{data.schema_name}.{data.table_name}</span>}
          {data.seq_scan_pct != null && <span>Seq scan: {data.seq_scan_pct}%</span>}
          {data.row_count != null && <span>Rows: {fmtNum(data.row_count)}</span>}
        </>
      );
    case "unused_index":
      return (
        <>
          {data.table_name && <span>Table: {data.table_name}</span>}
          {data.index_size_mb != null && <span>Size: {data.index_size_mb.toFixed(1)} MB</span>}
        </>
      );
    case "vacuum_needed":
      return (
        <>
          {data.schema_name && data.table_name && <span>{data.schema_name}.{data.table_name}</span>}
          {data.dead_pct != null && <span>Dead: {data.dead_pct}%</span>}
          {data.n_dead_tup != null && <span>Dead tuples: {fmtNum(data.n_dead_tup)}</span>}
        </>
      );
    default:
      return null;
  }
}

function DetailMetrics({ data, category }: { data: Record<string, any>; category: string }) {
  const rows: [string, string | number][] = [];

  switch (category) {
    case "slow_query":
      if (data.queryid) rows.push(["Query ID", data.queryid]);
      if (data.calls != null) rows.push(["Total calls", fmtNum(data.calls)]);
      if (data.mean_ms != null) rows.push(["Mean time", `${data.mean_ms.toFixed(1)} ms`]);
      if (data.total_ms != null) rows.push(["Total time", `${fmtNum(Math.round(data.total_ms))} ms`]);
      break;
    case "n_plus_one":
      if (data.queryid) rows.push(["Query ID", data.queryid]);
      if (data.calls != null) rows.push(["Total calls", fmtNum(data.calls)]);
      if (data.mean_ms != null) rows.push(["Mean time", `${data.mean_ms.toFixed(1)} ms`]);
      if (data.total_ms != null) rows.push(["Total time", `${fmtNum(Math.round(data.total_ms))} ms`]);
      break;
    case "missing_index":
      if (data.seq_scan != null) rows.push(["Seq scans", fmtNum(data.seq_scan)]);
      if (data.idx_scan != null) rows.push(["Index scans", fmtNum(data.idx_scan)]);
      if (data.seq_scan_pct != null) rows.push(["Seq scan %", `${data.seq_scan_pct}%`]);
      if (data.row_count != null) rows.push(["Row count", fmtNum(data.row_count)]);
      break;
    case "unused_index":
      if (data.index_name) rows.push(["Index", data.index_name]);
      if (data.table_name) rows.push(["Table", data.table_name]);
      if (data.index_size_mb != null) rows.push(["Size", `${data.index_size_mb.toFixed(1)} MB`]);
      break;
    case "vacuum_needed":
      if (data.n_dead_tup != null) rows.push(["Dead tuples", fmtNum(data.n_dead_tup)]);
      if (data.n_live_tup != null) rows.push(["Live tuples", fmtNum(data.n_live_tup)]);
      if (data.dead_pct != null) rows.push(["Dead %", `${data.dead_pct}%`]);
      if (data.row_count != null) rows.push(["Total rows", fmtNum(data.row_count)]);
      break;
  }

  if (rows.length === 0) return null;

  return (
    <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-text-muted">
      {rows.map(([label, value]) => (
        <span key={label}>{label}: <span className="text-text-secondary">{value}</span></span>
      ))}
    </div>
  );
}
/* eslint-enable @typescript-eslint/no-explicit-any */
