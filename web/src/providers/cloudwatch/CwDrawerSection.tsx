import { useState, useEffect, useCallback } from "react";
import { api } from "../../api";
import type { DrawerSectionProps } from "../types";
import { CwInvestigateModal } from "./CwInvestigateModal";

type SavedQuery = {
  id: string;
  label: string;
  log_group: string;
  question: string;
  query_template: string;
  use_count: number;
};

type Investigation = {
  id: string;
  question: string;
  status: string;
  log_group: string;
  created_at: string;
};

type CwAccount = {
  id: string;
  displayName: string;
};

type LogGroupResource = {
  id: string;
  external_id: string;
  name: string;
};

const TIME_RANGES = [
  { label: "15 min", value: 15 },
  { label: "1 hour", value: 60 },
  { label: "6 hours", value: 360 },
  { label: "24 hours", value: 1440 },
];

export function CwDrawerSection({
  selectedRepoId,
  busy,
  onBusyChange,
  onTasksRefresh,
  onError,
  onInfo,
}: DrawerSectionProps) {
  const [accounts, setAccounts] = useState<CwAccount[]>([]);
  const [selectedAccountId, setSelectedAccountId] = useState("");
  const [logGroups, setLogGroups] = useState<LogGroupResource[]>([]);
  const [selectedLogGroup, setSelectedLogGroup] = useState("");
  const [timeRange, setTimeRange] = useState(60);
  const [question, setQuestion] = useState("");
  const [savedQueries, setSavedQueries] = useState<SavedQuery[]>([]);
  const [recentInvestigations, setRecentInvestigations] = useState<Investigation[]>([]);
  const [modalOpen, setModalOpen] = useState(false);
  const [activeInvestigationId, setActiveInvestigationId] = useState("");

  const fetchAccounts = useCallback(async () => {
    try {
      const payload = await api<{
        providerAccounts?: Record<string, CwAccount[]>;
      }>("/api/bootstrap");
      const cwAccounts = payload.providerAccounts?.["cloudwatch"] ?? [];
      setAccounts(cwAccounts);
      if (cwAccounts.length === 1) setSelectedAccountId(cwAccounts[0].id);
    } catch {
      /* silent */
    }
  }, []);

  const fetchLogGroups = useCallback(async () => {
    if (!selectedAccountId) return;
    try {
      const payload = await api<{ resources: LogGroupResource[] }>(
        `/api/providers/cloudwatch/accounts/${selectedAccountId}/resources`
      );
      setLogGroups(payload.resources);
    } catch {
      /* silent */
    }
  }, [selectedAccountId]);

  const fetchSavedQueries = useCallback(async () => {
    if (!selectedRepoId) return;
    try {
      const payload = await api<{ queries: SavedQuery[] }>(
        `/api/cloudwatch/saved-queries?repo_id=${selectedRepoId}`
      );
      setSavedQueries(payload.queries);
    } catch {
      /* silent */
    }
  }, [selectedRepoId]);

  const fetchRecent = useCallback(async () => {
    if (!selectedRepoId) return;
    try {
      const payload = await api<{ investigations: Investigation[] }>(
        `/api/cloudwatch/investigations?repo_id=${selectedRepoId}`
      );
      setRecentInvestigations(payload.investigations.slice(0, 5));
    } catch {
      /* silent */
    }
  }, [selectedRepoId]);

  useEffect(() => {
    void fetchAccounts();
  }, [fetchAccounts]);

  useEffect(() => {
    void fetchLogGroups();
  }, [fetchLogGroups]);

  useEffect(() => {
    void fetchSavedQueries();
    void fetchRecent();
  }, [fetchSavedQueries, fetchRecent]);

  async function investigate() {
    if (!selectedRepoId || !selectedAccountId || !selectedLogGroup || !question.trim()) {
      onError("Log group and question are required.");
      return;
    }
    onError("");
    onBusyChange(true);
    try {
      const result = await api<{ id: string }>("/api/cloudwatch/investigate", {
        method: "POST",
        body: JSON.stringify({
          repoId: selectedRepoId,
          accountId: selectedAccountId,
          logGroup: selectedLogGroup,
          question: question.trim(),
          timeRangeMinutes: timeRange,
        }),
      });
      setActiveInvestigationId(result.id);
      setModalOpen(true);
      void fetchRecent();
    } catch (e) {
      onError((e as Error).message);
    } finally {
      onBusyChange(false);
    }
  }

  async function runSavedQuery(sq: SavedQuery) {
    if (!selectedRepoId || !selectedAccountId) {
      onError("Select an AWS account first.");
      return;
    }
    onError("");
    onBusyChange(true);
    try {
      const result = await api<{ id: string }>(`/api/cloudwatch/saved-queries/${sq.id}/run`, {
        method: "POST",
        body: JSON.stringify({
          repoId: selectedRepoId,
          accountId: selectedAccountId,
          timeRangeMinutes: timeRange,
        }),
      });
      setActiveInvestigationId(result.id);
      setModalOpen(true);
    } catch (e) {
      onError((e as Error).message);
    } finally {
      onBusyChange(false);
    }
  }

  function openInvestigation(inv: Investigation) {
    setActiveInvestigationId(inv.id);
    setModalOpen(true);
  }

  if (accounts.length === 0) {
    return <p className="text-xs text-text-muted">Connect AWS in Settings first.</p>;
  }

  return (
    <div className="space-y-3">
      {/* Account selector (if multiple) */}
      {accounts.length > 1 && (
        <select
          className="w-full rounded-md border border-border-strong bg-surface-300 px-2 py-1.5 text-xs text-text-primary"
          value={selectedAccountId}
          onChange={(e) => setSelectedAccountId(e.target.value)}
        >
          <option value="">Select AWS account</option>
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.displayName}
            </option>
          ))}
        </select>
      )}

      {/* Log group + time range */}
      <div className="flex gap-2">
        <select
          className="flex-1 rounded-md border border-border-strong bg-surface-300 px-2 py-1.5 text-xs text-text-primary"
          value={selectedLogGroup}
          onChange={(e) => setSelectedLogGroup(e.target.value)}
        >
          <option value="">Log group...</option>
          {logGroups.map((g) => (
            <option key={g.id} value={g.external_id}>
              {g.name}
            </option>
          ))}
        </select>
        <select
          className="w-24 rounded-md border border-border-strong bg-surface-300 px-2 py-1.5 text-xs text-text-primary"
          value={timeRange}
          onChange={(e) => setTimeRange(Number(e.target.value))}
        >
          {TIME_RANGES.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </select>
      </div>

      {/* Question textarea */}
      <textarea
        className="w-full rounded-md border border-border-strong bg-surface-300 px-3 py-2 text-xs text-text-primary placeholder:text-text-muted resize-none"
        rows={2}
        placeholder="tenant 12345 çek oluşturulamıyor..."
        value={question}
        onChange={(e) => setQuestion(e.target.value)}
      />

      <button
        onClick={() => void investigate()}
        disabled={busy || !selectedLogGroup || !question.trim()}
        className="w-full rounded-lg border border-brand/30 bg-brand/10 px-3 py-2 text-xs font-medium text-brand transition hover:bg-brand/20 disabled:opacity-40 disabled:cursor-not-allowed"
      >
        Investigate
      </button>

      {/* Saved Queries */}
      {savedQueries.length > 0 && (
        <div>
          <h4 className="mb-1.5 text-[10px] font-medium uppercase tracking-wide text-text-muted">
            Saved Queries
          </h4>
          <div className="space-y-1">
            {savedQueries.map((sq) => (
              <button
                key={sq.id}
                onClick={() => void runSavedQuery(sq)}
                disabled={busy}
                className="w-full flex items-center justify-between rounded-md border border-border-default bg-surface-200 px-2.5 py-1.5 text-xs text-text-secondary hover:bg-surface-300 transition"
              >
                <span className="truncate">{sq.label}</span>
                <span className="text-brand ml-1 shrink-0">▶</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Recent Investigations */}
      {recentInvestigations.length > 0 && (
        <div>
          <h4 className="mb-1.5 text-[10px] font-medium uppercase tracking-wide text-text-muted">
            Recent
          </h4>
          <div className="space-y-1">
            {recentInvestigations.map((inv) => (
              <button
                key={inv.id}
                onClick={() => openInvestigation(inv)}
                className="w-full flex items-center justify-between rounded-md border border-border-default bg-surface-200 px-2.5 py-1.5 text-xs text-text-secondary hover:bg-surface-300 transition"
              >
                <span className="truncate">
                  {inv.question.length > 40 ? inv.question.slice(0, 40) + "..." : inv.question}
                </span>
                <span
                  className={`ml-1 shrink-0 text-[10px] ${
                    inv.status === "completed"
                      ? "text-brand"
                      : inv.status === "failed"
                        ? "text-error-text"
                        : "text-text-muted"
                  }`}
                >
                  {inv.status === "completed" ? "✓" : inv.status === "failed" ? "✗" : "…"}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Modal */}
      <CwInvestigateModal
        open={modalOpen}
        onClose={() => {
          setModalOpen(false);
          void fetchSavedQueries();
          void fetchRecent();
        }}
        investigationId={activeInvestigationId}
        selectedRepoId={selectedRepoId}
        selectedAccountId={selectedAccountId}
        busy={busy}
        onBusyChange={onBusyChange}
        onTasksRefresh={onTasksRefresh}
        onError={onError}
        onInfo={onInfo}
      />
    </div>
  );
}
