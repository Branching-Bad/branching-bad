import { useState, useEffect, useCallback, useRef } from "react";
import { createPortal } from "react-dom";
import { api } from "../../api";
import { IconX } from "../../components/icons";

/* eslint-disable @typescript-eslint/no-explicit-any */

type Tab = "analysis" | "errors" | "trace" | "query";

type InvestigationData = {
  id: string;
  question: string;
  log_group: string;
  status: string;
  error_message: string | null;
  result_json: any;
  query_phase1: string | null;
};

type Props = {
  open: boolean;
  onClose: () => void;
  investigationId: string;
  selectedRepoId: string;
  selectedAccountId: string;
  busy: boolean;
  onBusyChange: (v: boolean) => void;
  onTasksRefresh: () => void;
  onError: (msg: string) => void;
  onInfo: (msg: string) => void;
};

const STATUS_LABELS: Record<string, string> = {
  running: "Running...",
  logs_ready: "Logs ready — review below",
  analyzing: "Analyzing logs...",
  completed: "Completed",
  failed: "Failed",
  no_results: "No results found",
};

export function CwInvestigateModal(props: Props) {
  const {
    open,
    onClose,
    investigationId,
    selectedRepoId,
    busy,
    onBusyChange,
    onTasksRefresh,
    onError,
    onInfo,
  } = props;
  const [data, setData] = useState<InvestigationData | null>(null);
  const [tab, setTab] = useState<Tab>("errors");
  const [saveLabel, setSaveLabel] = useState("");
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchInvestigation = useCallback(async () => {
    if (!investigationId) return;
    try {
      const payload = await api<{ investigation: InvestigationData }>(
        `/api/cloudwatch/investigations/${investigationId}`
      );
      setData(payload.investigation);
      return payload.investigation.status;
    } catch {
      return undefined;
    }
  }, [investigationId]);

  // Poll while running/analyzing
  useEffect(() => {
    if (!open || !investigationId) return;
    void fetchInvestigation();

    pollRef.current = setInterval(async () => {
      const status = await fetchInvestigation();
      if (status && !["running", "analyzing"].includes(status)) {
        if (pollRef.current) clearInterval(pollRef.current);
      }
    }, 2000);

    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [open, investigationId, fetchInvestigation]);

  // When data loads, pick the best default tab
  useEffect(() => {
    if (!data) return;
    if (data.status === "completed" && data.result_json?.analysis) {
      setTab("analysis");
    } else if (data.status === "no_results") {
      setTab("query");
    } else {
      setTab("errors");
    }
  }, [data?.status]);

  if (!open) return null;

  const result = data?.result_json ?? {};
  const errorLogs: any[] = result.error_logs ?? [];
  const traceLogs: Record<string, any[]> = result.trace_logs ?? {};
  const analysis = result.analysis;
  const relevantFiles: string[] = result.relevant_files ?? [];

  async function handleAnalyze() {
    onBusyChange(true);
    try {
      await api(`/api/cloudwatch/investigations/${investigationId}/analyze`, { method: "POST" });
      void fetchInvestigation();
      // Resume polling
      pollRef.current = setInterval(async () => {
        const status = await fetchInvestigation();
        if (status && !["running", "analyzing"].includes(status)) {
          if (pollRef.current) clearInterval(pollRef.current);
        }
      }, 2000);
    } catch (e) {
      onError((e as Error).message);
    } finally {
      onBusyChange(false);
    }
  }

  async function handleRegenerate() {
    onBusyChange(true);
    try {
      await api(`/api/cloudwatch/investigations/${investigationId}/regenerate`, { method: "POST" });
      void fetchInvestigation();
      pollRef.current = setInterval(async () => {
        const status = await fetchInvestigation();
        if (status && !["running", "analyzing"].includes(status)) {
          if (pollRef.current) clearInterval(pollRef.current);
        }
      }, 2000);
    } catch (e) {
      onError((e as Error).message);
    } finally {
      onBusyChange(false);
    }
  }

  async function handleSaveQuery() {
    if (!data || !saveLabel.trim()) return;
    try {
      await api("/api/cloudwatch/saved-queries", {
        method: "POST",
        body: JSON.stringify({
          repoId: selectedRepoId,
          logGroup: data.log_group,
          label: saveLabel.trim(),
          question: data.question,
          queryTemplate: data.query_phase1 ?? result.phase1_query ?? "",
          keywords: "",
        }),
      });
      onInfo("Query saved.");
      setSaveLabel("");
    } catch (e) {
      onError((e as Error).message);
    }
  }

  async function handleCreateTask() {
    onBusyChange(true);
    try {
      const res = await api<{ task: { id: string; title: string } }>(
        `/api/cloudwatch/investigations/${investigationId}/create-task`,
        { method: "POST" }
      );
      onInfo(`Task created: ${res.task.title}`);
      onTasksRefresh();
    } catch (e) {
      onError((e as Error).message);
    } finally {
      onBusyChange(false);
    }
  }

  function copyQuery() {
    const q = data?.query_phase1 ?? result.phase1_query ?? "";
    void navigator.clipboard.writeText(q);
    onInfo("Query copied to clipboard.");
  }

  const isTerminal = data && !["running", "analyzing"].includes(data.status);

  const tabs: { key: Tab; label: string; show: boolean }[] = [
    { key: "analysis", label: "Analysis", show: !!analysis },
    { key: "errors", label: `Errors (${errorLogs.length})`, show: errorLogs.length > 0 },
    { key: "trace", label: `Trace (${Object.keys(traceLogs).length})`, show: Object.keys(traceLogs).length > 0 },
    { key: "query", label: "Query", show: true },
  ];

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="relative flex w-[700px] max-h-[85vh] flex-col rounded-2xl border border-border-default bg-surface-100 shadow-2xl">
        {/* Header */}
        <div className="flex items-start justify-between border-b border-border-default px-5 py-4">
          <div className="min-w-0 flex-1">
            <h2 className="text-sm font-semibold text-text-primary truncate">
              {data?.question ?? "Investigation"}
            </h2>
            <p className="mt-0.5 text-xs text-text-muted">
              {data ? STATUS_LABELS[data.status] ?? data.status : "Loading..."}
              {data?.error_message && (
                <span className="text-error-text ml-2">{data.error_message}</span>
              )}
            </p>
          </div>
          <button onClick={onClose} className="ml-3 p-1 text-text-muted hover:text-text-primary transition">
            <IconX />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 border-b border-border-default px-5 pt-2">
          {tabs
            .filter((t) => t.show)
            .map((t) => (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                className={`px-3 py-1.5 text-xs font-medium rounded-t-md transition ${
                  tab === t.key
                    ? "bg-surface-200 text-text-primary border-b-2 border-brand"
                    : "text-text-muted hover:text-text-secondary"
                }`}
              >
                {t.label}
              </button>
            ))}
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4 text-xs">
          {/* Spinner while running */}
          {data && ["running", "analyzing"].includes(data.status) && (
            <div className="flex items-center gap-2 text-text-muted py-8 justify-center">
              <span className="animate-spin">⏳</span>
              <span>{data.status === "running" ? "Agent is generating query..." : "Agent is analyzing logs..."}</span>
            </div>
          )}

          {/* Analysis tab */}
          {tab === "analysis" && analysis && (
            <div className="space-y-4">
              <div>
                <h3 className="text-xs font-semibold text-text-secondary mb-1">Root Cause</h3>
                <p className="text-text-primary whitespace-pre-wrap">{analysis.root_cause}</p>
              </div>
              <div>
                <h3 className="text-xs font-semibold text-text-secondary mb-1">Summary</h3>
                <p className="text-text-primary whitespace-pre-wrap">{analysis.summary}</p>
              </div>
              <div>
                <h3 className="text-xs font-semibold text-text-secondary mb-1">Suggestion</h3>
                <p className="text-text-primary whitespace-pre-wrap">{analysis.suggestion}</p>
              </div>
              <div>
                <span
                  className={`inline-block rounded-full px-2 py-0.5 text-[10px] font-medium ${
                    analysis.severity === "critical"
                      ? "bg-red-900/40 text-red-400"
                      : analysis.severity === "high"
                        ? "bg-orange-900/40 text-orange-400"
                        : analysis.severity === "medium"
                          ? "bg-yellow-900/40 text-yellow-400"
                          : "bg-surface-300 text-text-muted"
                  }`}
                >
                  {analysis.severity}
                </span>
              </div>
              {relevantFiles.length > 0 && (
                <div>
                  <h3 className="text-xs font-semibold text-text-secondary mb-1">Relevant Files</h3>
                  <ul className="list-disc list-inside text-text-primary">
                    {relevantFiles.map((f: string, i: number) => (
                      <li key={i} className="font-mono text-[11px]">
                        {f}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}

          {/* Errors tab */}
          {tab === "errors" && (
            <div className="space-y-1">
              {errorLogs.length === 0 ? (
                <p className="text-text-muted py-4 text-center">No error logs found.</p>
              ) : (
                errorLogs.map((log: any, i: number) => (
                  <div
                    key={i}
                    className="rounded-md border border-border-default bg-surface-200 p-2 font-mono text-[11px] text-text-primary"
                  >
                    <span className="text-text-muted">[{log.timestamp}]</span>{" "}
                    <span className="break-all whitespace-pre-wrap">{log.message}</span>
                  </div>
                ))
              )}
            </div>
          )}

          {/* Trace tab */}
          {tab === "trace" && (
            <div className="space-y-4">
              {Object.keys(traceLogs).length === 0 ? (
                <p className="text-text-muted py-4 text-center">No trace data.</p>
              ) : (
                Object.entries(traceLogs).map(([cid, entries]) => (
                  <div key={cid}>
                    <h4 className="text-xs font-semibold text-text-secondary mb-1 font-mono">
                      {cid}
                    </h4>
                    <div className="space-y-0.5">
                      {(entries as any[]).map((e: any, i: number) => (
                        <div
                          key={i}
                          className="rounded border border-border-default bg-surface-200 px-2 py-1 font-mono text-[10px] text-text-primary"
                        >
                          <span className="text-text-muted">[{e.timestamp}]</span>{" "}
                          {e.message}
                        </div>
                      ))}
                    </div>
                  </div>
                ))
              )}
            </div>
          )}

          {/* Query tab */}
          {tab === "query" && (
            <div className="space-y-3">
              <pre className="rounded-md border border-border-default bg-surface-200 p-3 font-mono text-[11px] text-text-primary whitespace-pre-wrap">
                {data?.query_phase1 ?? result.phase1_query ?? "(no query yet)"}
              </pre>
              {result.phase1_reasoning && (
                <div>
                  <h4 className="text-xs font-semibold text-text-secondary mb-1">Agent Reasoning</h4>
                  <p className="text-text-primary whitespace-pre-wrap text-[11px]">
                    {result.phase1_reasoning}
                  </p>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        {isTerminal && (
          <div className="border-t border-border-default px-5 py-3 flex flex-wrap items-center gap-2">
            {data.status === "logs_ready" && (
              <>
                <button
                  onClick={() => void handleAnalyze()}
                  disabled={busy}
                  className="rounded-md bg-brand-dark px-3 py-1.5 text-xs font-medium text-text-primary border border-brand-glow transition hover:brightness-125 disabled:opacity-40"
                >
                  Analyze
                </button>
                <button
                  onClick={() => void handleRegenerate()}
                  disabled={busy}
                  className="rounded-md bg-surface-300 px-3 py-1.5 text-xs font-medium text-text-secondary border border-border-strong transition hover:bg-surface-200 disabled:opacity-40"
                >
                  Regenerate
                </button>
              </>
            )}

            {data.status === "completed" && (
              <button
                onClick={() => void handleCreateTask()}
                disabled={busy}
                className="rounded-md bg-brand-dark px-3 py-1.5 text-xs font-medium text-text-primary border border-brand-glow transition hover:brightness-125 disabled:opacity-40"
              >
                Create Fix Task
              </button>
            )}

            {data.status === "no_results" && (
              <button
                onClick={() => void handleRegenerate()}
                disabled={busy}
                className="rounded-md bg-surface-300 px-3 py-1.5 text-xs font-medium text-text-secondary border border-border-strong transition hover:bg-surface-200 disabled:opacity-40"
              >
                Regenerate Query
              </button>
            )}

            {/* Save Query */}
            {(data.status === "logs_ready" || data.status === "completed") && (
              <div className="flex items-center gap-1.5 ml-auto">
                <input
                  className="rounded-md border border-border-strong bg-surface-300 px-2 py-1 text-xs text-text-primary placeholder:text-text-muted w-36"
                  placeholder="Query label..."
                  value={saveLabel}
                  onChange={(e) => setSaveLabel(e.target.value)}
                />
                <button
                  onClick={() => void handleSaveQuery()}
                  disabled={!saveLabel.trim()}
                  className="rounded-md bg-surface-300 px-2 py-1 text-xs text-text-secondary border border-border-strong transition hover:bg-surface-200 disabled:opacity-40"
                >
                  Save
                </button>
              </div>
            )}

            <button
              onClick={copyQuery}
              className="rounded-md bg-surface-300 px-2 py-1.5 text-xs text-text-secondary border border-border-strong transition hover:bg-surface-200"
            >
              Copy Query
            </button>
          </div>
        )}
      </div>
    </div>,
    document.body
  );
}
/* eslint-enable @typescript-eslint/no-explicit-any */
