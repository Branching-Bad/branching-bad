import { useState, useRef } from "react";
import { createPortal } from "react-dom";
import { api } from "../../api";
import { IconX, IconRefresh } from "../../components/icons";
import type { ProviderItem } from "../../types";

const PROVIDER_ID = "sentry";

type Tab = "new" | "fixed" | "ignored";

type EventCache = Record<string, { loading: boolean; trace: string | null; error?: string }>;

/* eslint-disable @typescript-eslint/no-explicit-any */
function extractStackTrace(event: any): string | null {
  if (!event) return null;

  function formatValues(values: any[]): string | null {
    const lines: string[] = [];
    for (const exc of values) {
      const t = exc?.type ?? "Exception";
      const v = exc?.value ?? "";
      lines.push(`${t}: ${v}`);
      const frames: any[] = exc?.stacktrace?.frames;
      if (frames) {
        for (const f of [...frames].reverse().slice(0, 15)) {
          const file = f?.filename ?? f?.absPath ?? "?";
          const lineno = f?.lineno ?? 0;
          const colno = f?.colNo ?? f?.colno;
          const func = f?.function ?? "?";
          const loc = colno && colno > 0 ? `${file}:${lineno}:${colno}` : `${file}:${lineno}`;
          lines.push(`  at ${func} (${loc})`);
        }
      }
    }
    return lines.length ? lines.join("\n") : null;
  }

  // entries array format
  if (Array.isArray(event.entries)) {
    for (const entry of event.entries) {
      if (entry?.type === "exception" && Array.isArray(entry?.data?.values)) {
        const r = formatValues(entry.data.values);
        if (r) return r;
      }
    }
  }

  // top-level exception format
  if (Array.isArray(event?.exception?.values)) {
    const r = formatValues(event.exception.values);
    if (r) return r;
  }

  return null;
}
/* eslint-enable @typescript-eslint/no-explicit-any */

export function SentryIssuesModal({
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
  const [tab, setTab] = useState<Tab>("new");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [eventCache, setEventCache] = useState<EventCache>({});
  const fetchingRef = useRef<Set<string>>(new Set());

  if (!open) return null;

  const pending = items.filter((i) => i.status === "pending" || i.status === "regression");
  const fixed = items.filter((i) => i.status === "accepted");
  const ignored = items.filter((i) => i.status === "ignored");

  const displayed = tab === "new" ? pending : tab === "fixed" ? fixed : ignored;

  function fetchEvent(itemId: string) {
    if (eventCache[itemId] || fetchingRef.current.has(itemId)) return;
    fetchingRef.current.add(itemId);
    setEventCache((prev) => ({ ...prev, [itemId]: { loading: true, trace: null } }));
    api<{ event: unknown }>(`/api/providers/${PROVIDER_ID}/items/${itemId}/event`)
      .then((res) => {
        const trace = extractStackTrace(res.event);
        setEventCache((prev) => ({ ...prev, [itemId]: { loading: false, trace } }));
      })
      .catch((e) => {
        setEventCache((prev) => ({ ...prev, [itemId]: { loading: false, trace: null, error: (e as Error).message } }));
      })
      .finally(() => { fetchingRef.current.delete(itemId); });
  }

  function toggleExpand(itemId: string) {
    if (expandedId === itemId) {
      setExpandedId(null);
    } else {
      setExpandedId(itemId);
      fetchEvent(itemId);
    }
  }

  async function clearAll() {
    if (!selectedRepoId) return;
    onError(""); onBusyChange(true);
    try {
      await api(`/api/providers/${PROVIDER_ID}/items/clear/${selectedRepoId}`, { method: "POST" });
      setItems([]);
      setEventCache({});
      setExpandedId(null);
      onInfo("All Sentry items cleared. Re-sync to fetch fresh data.");
    } catch (e) { onError((e as Error).message); } finally { onBusyChange(false); }
  }

  async function syncNow() {
    if (!selectedRepoId) return;
    onError(""); onBusyChange(true);
    try {
      const result = await api<{ synced: number; errors?: string[] }>(`/api/providers/${PROVIDER_ID}/sync/${selectedRepoId}`, { method: "POST" });
      const payload = await api<{ items: ProviderItem[] }>(`/api/providers/${PROVIDER_ID}/items/${selectedRepoId}`);
      setItems(payload.items);
      setEventCache({});
      if (result.errors?.length) {
        onError(`Sync issues: ${result.errors.join("; ")}`);
      } else {
        onInfo(`Sentry sync complete. ${result.synced} issue(s) synced.`);
      }
    } catch (e) { onError((e as Error).message); } finally { onBusyChange(false); }
  }

  async function ignoreItem(itemId: string) {
    try {
      await api(`/api/providers/${PROVIDER_ID}/items/${itemId}/action`, { method: "POST", body: JSON.stringify({ action: "ignore" }) });
      setItems((prev) => prev.map((i) => i.id === itemId ? { ...i, status: "ignored" } : i));
    } catch (e) { onError((e as Error).message); }
  }

  async function restoreItem(itemId: string) {
    try {
      await api(`/api/providers/${PROVIDER_ID}/items/${itemId}/action`, { method: "POST", body: JSON.stringify({ action: "restore" }) });
      setItems((prev) => prev.map((i) => i.id === itemId ? { ...i, status: "pending" } : i));
    } catch (e) { onError((e as Error).message); }
  }

  async function createTask(itemId: string) {
    onError(""); onBusyChange(true);
    try {
      await api(`/api/providers/${PROVIDER_ID}/items/${itemId}/create-task`, { method: "POST" });
      setItems((prev) => prev.map((i) => i.id === itemId ? { ...i, status: "accepted" } : i));
      onTasksRefresh();
      onInfo("Task created from Sentry issue. Plan generation started.");
    } catch (e) { onError((e as Error).message); } finally { onBusyChange(false); }
  }

  const tabs: { key: Tab; label: string; count: number }[] = [
    { key: "new", label: "New", count: pending.length },
    { key: "fixed", label: "Fixed", count: fixed.length },
    { key: "ignored", label: "Ignored", count: ignored.length },
  ];

  return createPortal(
    <div className="fixed inset-0 z-[70] flex items-center justify-center">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-[640px] rounded-2xl border border-border-default bg-surface-100 shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border-default px-6 py-4">
          <h3 className="text-base font-medium text-text-primary">Sentry Issues</h3>
          <div className="flex items-center gap-2">
            <button
              onClick={() => void clearAll()}
              disabled={busy}
              className="flex items-center gap-1.5 rounded-lg border border-red-500/30 bg-red-500/5 px-3 py-1.5 text-xs font-medium text-red-400 transition hover:bg-red-500/10 disabled:opacity-50"
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

        {/* Tabs */}
        <div className="flex border-b border-border-default px-6">
          {tabs.map((t) => (
            <button
              key={t.key}
              onClick={() => { setTab(t.key); setExpandedId(null); }}
              className={`relative px-4 py-2.5 text-xs font-medium transition ${
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
              {tab === "new" ? "No pending issues." : tab === "fixed" ? "No fixed issues." : "No ignored issues."}
            </p>
          ) : (
            <div className="space-y-2">
              {displayed.map((item) => {
                const data = (() => { try { return JSON.parse(item.data_json); } catch { return {}; } })();
                const isExpanded = expandedId === item.id;
                const cached = eventCache[item.id];
                return (
                  <div key={item.id} className="rounded-xl border border-border-default bg-surface-200">
                    <button
                      type="button"
                      onClick={() => toggleExpand(item.id)}
                      className="w-full p-3 text-left"
                    >
                      <div className="flex items-center gap-2">
                        <span className={`inline-block h-2 w-2 shrink-0 rounded-full ${
                          data.level === "fatal" ? "bg-red-600" : data.level === "error" ? "bg-red-400" : "bg-yellow-400"
                        }`} />
                        <span className="truncate text-xs font-medium text-text-primary">{item.title}</span>
                        {item.status === "regression" && (
                          <span className="shrink-0 rounded bg-red-500/10 px-1.5 py-0.5 text-[10px] font-bold text-red-400 uppercase">Regression</span>
                        )}
                        {tab === "fixed" && item.linked_task_id && (
                          <span className="shrink-0 rounded bg-green-500/10 px-1.5 py-0.5 text-[10px] font-bold text-green-400">
                            Task linked
                          </span>
                        )}
                        <svg className={`ml-auto h-3.5 w-3.5 shrink-0 text-text-muted transition-transform ${isExpanded ? "rotate-180" : ""}`} fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" d="m19.5 8.25-7.5 7.5-7.5-7.5" />
                        </svg>
                      </div>
                      <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-text-muted">
                        {data.culprit && <span>{data.culprit}</span>}
                        {data.level && <span>Level: {data.level}</span>}
                        {data.occurrence_count && <span>Count: {data.occurrence_count}</span>}
                      </div>
                    </button>

                    {isExpanded && (
                      <div className="border-t border-border-default px-3 pb-3 pt-2">
                        {/* Metadata */}
                        <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-text-muted">
                          {data.first_seen && <span>First seen: {new Date(data.first_seen).toLocaleDateString()}</span>}
                          {data.last_seen && <span>Last seen: {new Date(data.last_seen).toLocaleDateString()}</span>}
                        </div>

                        {/* Stack trace — lazy loaded */}
                        {cached?.loading ? (
                          <p className="mt-2 text-[11px] text-text-muted animate-pulse">Loading stack trace…</p>
                        ) : cached?.trace ? (
                          <pre className="mt-2 max-h-[200px] overflow-auto rounded-lg bg-surface-100 p-2.5 text-[11px] leading-relaxed text-text-secondary font-mono">{cached.trace}</pre>
                        ) : cached?.error ? (
                          <p className="mt-2 text-[11px] text-red-400">Failed to load event: {cached.error}</p>
                        ) : (
                          <p className="mt-2 text-[11px] text-text-muted italic">No stack trace available.</p>
                        )}

                        {/* Actions */}
                        <div className="mt-2.5 flex gap-1.5">
                          {tab === "new" && (
                            <>
                              <button
                                onClick={() => void createTask(item.id)}
                                disabled={busy}
                                className="rounded-md bg-brand px-3 py-1 text-xs font-medium text-white transition hover:bg-brand-hover disabled:opacity-50"
                              >
                                Fix
                              </button>
                              <button
                                onClick={() => void ignoreItem(item.id)}
                                className="rounded-md border border-border-default px-3 py-1 text-xs font-medium text-text-muted transition hover:bg-surface-300"
                              >
                                Ignore
                              </button>
                            </>
                          )}
                          {tab === "fixed" && (
                            <button
                              onClick={() => void restoreItem(item.id)}
                              className="rounded-md border border-border-default px-3 py-1 text-xs font-medium text-text-muted transition hover:bg-surface-300"
                            >
                              Reopen
                            </button>
                          )}
                          {tab === "ignored" && (
                            <button
                              onClick={() => void restoreItem(item.id)}
                              className="rounded-md border border-border-default px-3 py-1 text-xs font-medium text-text-muted transition hover:bg-surface-300"
                            >
                              Restore
                            </button>
                          )}
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
