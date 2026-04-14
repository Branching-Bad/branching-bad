import { useState, useRef, useEffect, useCallback } from "react";
import type { AgentProfile, Repo, RunLogEntry } from "../types";
import type { AnalystHistoryEntry } from "../hooks/useAnalystState";
import { IconX, IconAnalyst } from "./icons";
import { AgentProfileSelect } from "./AgentProfileSelect";
import { AnalystChat } from "./AnalystChat";

const ANALYST_VISIBLE_TYPES = new Set([
  "thinking", "agent_text", "user_message", "turn_separator",
  "tool_use", "tool_result", "agent_done",
]);

function Spinner({ className = "w-4 h-4" }: { className?: string }) {
  return (
    <svg className={`${className} animate-spin`} viewBox="0 0 24 24" fill="none">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
    </svg>
  );
}

function formatTime(value: string | number): string {
  try {
    return new Date(value).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  } catch {
    return "";
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// History list (variants: 'inline' inside modal, 'island' as standalone card)
// ─────────────────────────────────────────────────────────────────────────────

function HistoryList({
  history,
  viewingHistoryId,
  activeSessionId,
  onSelect,
  onDelete,
  onBackToActive,
  variant,
}: {
  history: AnalystHistoryEntry[];
  viewingHistoryId: string | null;
  activeSessionId: string | null;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
  onBackToActive: () => void;
  variant: "inline" | "island";
}) {
  if (history.length === 0 && !activeSessionId) return null;

  const outer =
    variant === "island"
      ? "flex w-64 shrink-0 flex-col overflow-hidden rounded-[var(--radius-xl)] border border-border-default bg-surface-100 shadow-[var(--shadow-md)]"
      : "flex w-60 shrink-0 flex-col border-r border-border-default bg-surface-100/80";

  return (
    <aside className={outer}>
      <header className="flex items-center justify-between px-4 pt-4 pb-3">
        <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-text-muted">
          History
        </span>
        <span className="text-[11px] tabular-nums text-text-muted">
          {history.length + (activeSessionId ? 1 : 0)}
        </span>
      </header>

      <div className="mx-3 mb-2 border-t border-border-default/60" />

      <div className="flex-1 overflow-y-auto px-2 pb-3">
        {activeSessionId && (
          <button
            onClick={onBackToActive}
            className={`group mt-0.5 flex w-full items-start gap-2 rounded-[var(--radius-md)] px-2.5 py-2 text-left transition ${
              !viewingHistoryId
                ? "bg-brand-tint text-text-primary shadow-[inset_0_0_0_1px_var(--color-brand-glow)]"
                : "hover:bg-surface-200"
            }`}
          >
            <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-status-success" />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[12px] font-medium text-text-primary">
                Active session
              </span>
              <span className="mt-0.5 block text-[10px] text-text-muted">Current conversation</span>
            </span>
          </button>
        )}

        {history.map((entry) => {
          const active = viewingHistoryId === entry.id;
          return (
            <div
              key={entry.id}
              className={`group mt-0.5 flex items-start gap-2 rounded-[var(--radius-md)] px-2.5 py-2 transition ${
                active
                  ? "bg-brand-tint shadow-[inset_0_0_0_1px_var(--color-brand-glow)]"
                  : "hover:bg-surface-200"
              }`}
            >
              <span
                className={`mt-1 h-1.5 w-1.5 shrink-0 rounded-full ${
                  active ? "bg-brand" : "bg-text-muted/40"
                }`}
              />
              <button onClick={() => onSelect(entry.id)} className="min-w-0 flex-1 text-left">
                <span className="block truncate text-[12px] text-text-primary">
                  {entry.title || entry.firstMessage}
                </span>
                <span className="mt-0.5 block text-[10px] text-text-muted">
                  {formatTime(entry.timestamp)}
                </span>
              </button>
              <button
                onClick={() => onDelete(entry.id)}
                className="mt-0.5 shrink-0 rounded-full p-1 text-text-muted opacity-0 transition hover:bg-surface-300 hover:text-text-primary group-hover:opacity-100"
                aria-label="Delete history entry"
              >
                <IconX className="h-3 w-3" />
              </button>
            </div>
          );
        })}
      </div>
    </aside>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Main chat panel
// ─────────────────────────────────────────────────────────────────────────────

type AnalystStateProps = {
  sessionId: string | null;
  profileId: string;
  setProfileId: (v: string) => void;
  loading: boolean;
  logs: RunLogEntry[];
  isConnected: boolean;
  history: AnalystHistoryEntry[];
  viewingHistoryId: string | null;
  startSession: (repoId: string, message: string, additionalRepoIds?: string[]) => Promise<void>;
  sendMessage: (content: string) => Promise<void>;
  archiveAndReset: () => Promise<void>;
  loadHistoryEntry: (id: string | null) => Promise<void>;
  deleteHistoryEntry: (id: string) => Promise<void>;
  extractTaskFields: () => { title: string; description: string } | null;
};

export function TaskAnalystPanel({
  repoId,
  repos,
  agentProfiles,
  onCreateTask,
  analystState,
  autoFocus = false,
  layout = "inline",
}: {
  repoId: string;
  repos: Repo[];
  agentProfiles: AgentProfile[];
  onCreateTask: (prefill: { title: string; description: string }) => void;
  analystState: AnalystStateProps;
  autoFocus?: boolean;
  layout?: "inline" | "island";
}) {
  const [input, setInput] = useState("");
  const [extraRepoIds, setExtraRepoIds] = useState<string[]>([]);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const {
    sessionId, profileId, setProfileId, loading, logs,
    history, viewingHistoryId,
    startSession, sendMessage, archiveAndReset,
    loadHistoryEntry, deleteHistoryEntry, extractTaskFields,
  } = analystState;

  const otherRepos = repos.filter((r) => r.id !== repoId);
  const isViewingHistory = viewingHistoryId !== null;
  const viewedEntry = isViewingHistory ? history.find((h) => h.id === viewingHistoryId) : null;
  const displayLogs = isViewingHistory ? (viewedEntry?.logs ?? []) : logs;
  const filteredLogs = displayLogs.filter((l) => ANALYST_VISIBLE_TYPES.has(l.type));
  const showHistory = history.length > 0 || sessionId !== null;
  const hasOutput = displayLogs.some(
    (l) => l.type === "agent_text" && l.data.includes("---TASK_OUTPUT_START---"),
  );

  useEffect(() => {
    if (autoFocus) setTimeout(() => inputRef.current?.focus(), 100);
  }, [autoFocus]);

  const handleSend = useCallback(async () => {
    const text = input.trim();
    if (!text || loading || isViewingHistory) return;
    setInput("");
    if (!sessionId) {
      await startSession(repoId, text, extraRepoIds.length ? extraRepoIds : undefined);
    } else {
      await sendMessage(text);
    }
  }, [input, loading, isViewingHistory, sessionId, repoId, extraRepoIds, startSession, sendMessage]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void handleSend();
    }
  };

  const handleCreateTask = () => {
    const fields = extractTaskFields();
    if (fields) onCreateTask(fields);
  };

  const handleNew = () => {
    void archiveAndReset();
    setInput("");
    setExtraRepoIds([]);
  };

  // Outer shell style: 'island' = rounded-xl floating card; 'inline' = bare flex (for modal)
  const outerWrap =
    layout === "island"
      ? "flex h-full w-full gap-3"
      : "flex flex-1 overflow-hidden";
  const mainWrap =
    layout === "island"
      ? "flex min-w-0 flex-1 flex-col overflow-hidden rounded-[var(--radius-xl)] border border-border-default bg-surface-100 shadow-[var(--shadow-md)]"
      : "flex flex-1 flex-col overflow-hidden";

  return (
    <div className={outerWrap}>
      {showHistory && (
        <HistoryList
          history={history}
          viewingHistoryId={viewingHistoryId}
          activeSessionId={sessionId}
          onSelect={loadHistoryEntry}
          onDelete={deleteHistoryEntry}
          onBackToActive={() => loadHistoryEntry(null)}
          variant={layout}
        />
      )}

      <div className={mainWrap}>
        {/* ── Toolbar: profile + loading ────────────────────── */}
        <header className="flex items-center gap-3 border-b border-border-default bg-surface-100/70 px-5 py-3 backdrop-blur-md">
          <div className="flex items-center gap-2">
            <IconAnalyst className="h-4 w-4 text-status-warning" />
            <span className="text-[13px] font-semibold text-text-primary">Task Analyst</span>
          </div>
          <div className="mx-1 h-5 w-px bg-border-default" />
          <div className="min-w-0 flex-1">
            <AgentProfileSelect
              profiles={agentProfiles}
              value={profileId}
              onChange={setProfileId}
            />
          </div>
          {loading && (
            <div className="flex items-center gap-1.5 rounded-full bg-brand-tint px-2.5 py-1 text-[11px] font-medium text-brand">
              <Spinner className="h-3 w-3" />
              Analyzing…
            </div>
          )}
        </header>

        {/* ── Additional repos (only pre-session) ───────────── */}
        {!sessionId && !isViewingHistory && otherRepos.length > 0 && (
          <div className="border-b border-border-default bg-surface-0/40 px-5 py-2.5">
            <p className="mb-2 text-[11px] font-medium uppercase tracking-[0.08em] text-text-muted">
              Additional repositories for context
            </p>
            <div className="flex flex-wrap gap-1.5">
              {otherRepos.map((r) => {
                const selected = extraRepoIds.includes(r.id);
                return (
                  <button
                    key={r.id}
                    onClick={() =>
                      setExtraRepoIds((prev) =>
                        selected ? prev.filter((id) => id !== r.id) : [...prev, r.id],
                      )
                    }
                    className={`rounded-full px-2.5 py-1 text-[11px] font-medium transition ${
                      selected
                        ? "bg-brand-tint text-brand shadow-[inset_0_0_0_1px_var(--color-brand-glow)]"
                        : "bg-surface-200 text-text-secondary hover:bg-surface-300 hover:text-text-primary"
                    }`}
                  >
                    {r.name}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* ── Messages area ─────────────────────────────────── */}
        <div className="flex-1 overflow-hidden px-4 py-4">
          {filteredLogs.length === 0 ? (
            <div className="flex h-full items-center justify-center">
              <div className="mx-auto max-w-xs text-center">
                <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-status-warning-soft">
                  <IconAnalyst className="h-6 w-6 text-status-warning" />
                </div>
                <p className="text-[13px] font-medium text-text-primary">
                  Start a conversation
                </p>
                <p className="mt-1 text-[12px] leading-relaxed text-text-muted">
                  Describe a feature or requirement. The analyst will ask clarifying questions
                  and help structure a task.
                </p>
              </div>
            </div>
          ) : (
            <AnalystChat logs={filteredLogs} className="h-full" isStreaming={loading} />
          )}
        </div>

        {/* ── Composer ──────────────────────────────────────── */}
        {!isViewingHistory && (
          <div className="border-t border-border-default bg-surface-0/40 px-4 py-3">
            <div className="flex items-end gap-2 rounded-[var(--radius-lg)] border border-border-default bg-surface-200 p-1.5 transition focus-within:border-border-focus focus-within:shadow-[0_0_0_3px_var(--color-brand-glow)]">
              <textarea
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={sessionId ? "Type your response…" : "Describe a feature or requirement…"}
                rows={2}
                className="flex-1 resize-none bg-transparent px-2 py-1.5 text-[13px] text-text-primary placeholder:text-text-muted focus:outline-none"
              />
              <button
                onClick={() => void handleSend()}
                disabled={!input.trim() || loading || !profileId}
                aria-label="Send"
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand text-white shadow-[0_1px_2px_rgba(0,0,0,0.2)] transition hover:bg-brand-dark disabled:bg-surface-300 disabled:text-text-muted"
              >
                {loading ? (
                  <Spinner className="h-3.5 w-3.5" />
                ) : (
                  <svg className="h-3.5 w-3.5" viewBox="0 0 14 14" fill="none">
                    <path d="M2 7h10M8 3l4 4-4 4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                )}
              </button>
            </div>
            {!profileId && (
              <p className="mt-2 flex items-center gap-1.5 text-[11px] text-status-warning">
                <svg className="h-3 w-3" viewBox="0 0 12 12" fill="currentColor">
                  <circle cx="6" cy="6" r="5" fillOpacity="0.2" />
                  <path d="M6 3v3.5M6 8.5v.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
                </svg>
                Select an agent profile to start.
              </p>
            )}
          </div>
        )}

        {/* ── Footer actions ────────────────────────────────── */}
        <div className="flex items-center justify-between gap-2 border-t border-border-default bg-surface-100/70 px-4 py-2.5 backdrop-blur-md">
          <button
            onClick={handleNew}
            disabled={!sessionId && !isViewingHistory}
            className="flex items-center gap-1.5 rounded-full border border-border-default bg-surface-200 px-3 py-1 text-[11px] font-medium text-text-secondary transition hover:bg-surface-300 hover:text-text-primary disabled:opacity-40 disabled:hover:bg-surface-200"
          >
            <svg className="h-3 w-3" viewBox="0 0 12 12" fill="none">
              <path d="M6 2v8M2 6h8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
            New session
          </button>
          <button
            onClick={handleCreateTask}
            disabled={!hasOutput}
            className="flex items-center gap-1.5 rounded-full bg-brand px-3 py-1 text-[11px] font-semibold text-white shadow-[0_1px_2px_rgba(0,0,0,0.2)] transition hover:bg-brand-dark disabled:opacity-40 disabled:hover:bg-brand"
          >
            <svg className="h-3 w-3" viewBox="0 0 12 12" fill="none">
              <path d="M2 6.5L5 9.5L10 3.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            Create Task
          </button>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Modal wrapper
// ─────────────────────────────────────────────────────────────────────────────

export function TaskAnalystModal({
  open,
  onClose,
  repoId,
  repos,
  agentProfiles,
  onCreateTask,
  analystState,
}: {
  open: boolean;
  onClose: () => void;
  repoId: string;
  repos: Repo[];
  agentProfiles: AgentProfile[];
  onCreateTask: (prefill: { title: string; description: string }) => void;
  analystState: AnalystStateProps;
}) {
  const [focusTrigger, setFocusTrigger] = useState(0);
  useEffect(() => {
    if (open) setFocusTrigger((n) => n + 1);
  }, [open]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative flex h-[85vh] w-full max-w-5xl flex-col overflow-hidden rounded-[var(--radius-2xl)] border border-border-default bg-surface-100 shadow-[var(--shadow-lg)]">
        {/* Close chip */}
        <button
          onClick={onClose}
          className="absolute right-3 top-3 z-10 flex h-7 w-7 items-center justify-center rounded-full bg-surface-200/80 text-text-muted backdrop-blur-md transition hover:bg-surface-300 hover:text-text-primary"
          aria-label="Close"
        >
          <IconX className="h-3.5 w-3.5" />
        </button>

        <TaskAnalystPanel
          repoId={repoId}
          repos={repos}
          agentProfiles={agentProfiles}
          onCreateTask={(prefill) => {
            onCreateTask(prefill);
            onClose();
          }}
          analystState={analystState}
          autoFocus={focusTrigger > 0}
          layout="inline"
        />
      </div>
    </div>
  );
}
