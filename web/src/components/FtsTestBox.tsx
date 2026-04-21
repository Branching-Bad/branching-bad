import { useState, type ReactNode } from "react";
import { api } from "../api";
import { inputClass } from "./shared";

interface FtsTestResponse<T> {
  raw: string;
  sanitized: string;
  matchExpr: string;
  results: T[];
  error?: string;
}

export function FtsTestBox<T extends { id: string; rank: number }>({
  repoId,
  endpoint,
  placeholder,
  renderItem,
}: {
  repoId: string;
  endpoint: string;
  placeholder?: string;
  renderItem: (item: T, index: number) => ReactNode;
}) {
  const [query, setQuery] = useState("");
  const [resp, setResp] = useState<FtsTestResponse<T> | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const run = async () => {
    if (!repoId || !query.trim()) return;
    setBusy(true);
    setErr(null);
    try {
      const params = new URLSearchParams({ repoId, q: query, limit: "10" });
      const res = await api<FtsTestResponse<T>>(`${endpoint}?${params}`);
      setResp(res);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      setResp(null);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-lg border border-border-strong bg-surface-100 p-3 space-y-2">
      <div className="flex items-center justify-between">
        <h4 className="text-xs font-semibold text-text-muted uppercase tracking-wider">FTS Test</h4>
        <span className="text-[10px] text-text-muted">Simulates planner retrieval · BM25 ranked</span>
      </div>
      <textarea
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void run();
        }}
        placeholder={placeholder ?? "Paste a task prompt or keywords to test retrieval..."}
        rows={3}
        className={`${inputClass} !py-1.5 !text-xs resize-none font-mono`}
      />
      <div className="flex items-center gap-2">
        <button
          onClick={() => void run()}
          disabled={busy || !repoId || !query.trim()}
          className="shrink-0 rounded-md bg-brand px-3 py-1.5 text-[11px] font-medium text-white transition hover:bg-brand/80 disabled:bg-surface-400 disabled:text-text-muted disabled:cursor-not-allowed"
        >
          {busy ? "Testing..." : "Run FTS test"}
        </button>
        <span className="text-[10px] text-text-muted">Cmd/Ctrl+Enter to run</span>
      </div>

      {err && <p className="text-[11px] text-status-danger">{err}</p>}

      {resp && (
        <div className="space-y-2 pt-1">
          <div className="rounded-md bg-surface-200 px-2 py-1.5 text-[10px] font-mono text-text-muted break-all">
            <span className="text-text-secondary">sanitized:</span>{" "}
            {resp.sanitized || <span className="italic">(empty — no tokens after stripping non-word chars)</span>}
          </div>
          {resp.matchExpr && (
            <div
              className="rounded-md bg-surface-200 px-2 py-1.5 text-[10px] font-mono text-text-muted break-all"
              title="Tokens are OR-joined so any match counts; BM25 ranks multi-hits higher"
            >
              <span className="text-text-secondary">FTS5 MATCH:</span> {resp.matchExpr}
            </div>
          )}
          {resp.error && (
            <p className="text-[10px] text-status-danger font-mono">FTS error: {resp.error}</p>
          )}
          {resp.results.length === 0 && !resp.error && (
            <p className="text-[11px] text-text-muted italic">No matches. Planner would fall back to recent entries.</p>
          )}
          {resp.results.length > 0 && (
            <ol className="space-y-1.5">
              {resp.results.map((r, i) => (
                <li key={r.id} className="rounded-md border border-border-default bg-surface-200 px-2.5 py-1.5 text-[11px]">
                  <div className="flex items-center justify-between gap-2 mb-0.5">
                    <span className="text-[10px] text-text-muted">#{i + 1}</span>
                    <span
                      className="text-[10px] font-mono text-text-muted"
                      title="BM25 score — lower (more negative) = more relevant"
                    >
                      bm25 {r.rank.toFixed(3)}
                    </span>
                  </div>
                  {renderItem(r, i)}
                </li>
              ))}
            </ol>
          )}
        </div>
      )}
    </div>
  );
}
