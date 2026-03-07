import { useState, useRef, useEffect, useCallback } from "react";
import type { AgentProfile, Repo, RunLogEntry } from "../types";
import type { AnalystHistoryEntry } from "../hooks/useAnalystState";
import { IconX, IconAnalyst } from "./icons";
import { AgentProfileSelect } from "./AgentProfileSelect";
import { LogViewer } from "./LogViewer";
import { btnPrimary, btnSecondary } from "./shared";

const ANALYST_VISIBLE_TYPES = new Set(["thinking", "agent_text", "user_message", "turn_separator"]);

function Spinner({ className = "w-4 h-4" }: { className?: string }) {
  return (
    <svg className={`${className} animate-spin`} viewBox="0 0 24 24" fill="none">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
    </svg>
  );
}

function HistoryPanel({
  history,
  viewingHistoryId,
  activeSessionId,
  onSelect,
  onDelete,
  onBackToActive,
}: {
  history: AnalystHistoryEntry[];
  viewingHistoryId: string | null;
  activeSessionId: string | null;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
  onBackToActive: () => void;
}) {
  if (history.length === 0 && !activeSessionId) return null;

  return (
    <div className="flex w-52 shrink-0 flex-col border-r border-border-default">
      <div className="border-b border-border-default px-3 py-2">
        <span className="text-xs font-medium text-text-muted">History</span>
      </div>
      <div className="flex-1 overflow-y-auto">
        {activeSessionId && (
          <button
            onClick={onBackToActive}
            className={`w-full border-b border-border-default px-3 py-2 text-left transition hover:bg-surface-200 ${
              !viewingHistoryId ? "bg-surface-200" : ""
            }`}
          >
            <div className="flex items-center gap-1.5">
              <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-green-500" />
              <span className="truncate text-xs font-medium text-text-primary">Active Session</span>
            </div>
          </button>
        )}
        {history.map((entry) => (
          <div
            key={entry.id}
            className={`group flex items-start gap-1 border-b border-border-default px-3 py-2 transition hover:bg-surface-200 ${
              viewingHistoryId === entry.id ? "bg-surface-200" : ""
            }`}
          >
            <button
              onClick={() => onSelect(entry.id)}
              className="min-w-0 flex-1 text-left"
            >
              <p className="truncate text-xs text-text-primary">
                {entry.title || entry.firstMessage}
              </p>
              <p className="mt-0.5 text-[10px] text-text-muted">
                {new Date(entry.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
              </p>
            </button>
            <button
              onClick={() => onDelete(entry.id)}
              className="mt-0.5 shrink-0 rounded p-0.5 text-text-muted opacity-0 transition hover:bg-surface-300 hover:text-text-primary group-hover:opacity-100"
            >
              <IconX className="h-3 w-3" />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

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
  analystState: {
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

  // Focus input when modal opens
  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 100);
  }, [open]);

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

  // Close just hides the modal — session stays alive
  const handleClose = () => {
    onClose();
  };

  const handleCreateTask = () => {
    const fields = extractTaskFields();
    if (fields) {
      onCreateTask(fields);
      handleClose();
    }
  };

  // "New" archives current session and resets for a new one
  const handleNew = () => {
    void archiveAndReset();
    setInput("");
    setExtraRepoIds([]);
  };

  const hasOutput = displayLogs.some(
    (l) => l.type === "agent_text" && l.data.includes("---TASK_OUTPUT_START---"),
  );

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={handleClose} />
      <div className="relative flex h-[80vh] w-full max-w-4xl flex-col rounded-2xl border border-border-default bg-surface-100 shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border-default px-5 py-3">
          <div className="flex items-center gap-2.5">
            <IconAnalyst className="w-5 h-5 text-orange-500" />
            <h3 className="text-sm font-medium text-text-primary">Task Analyst</h3>
            {loading && (
              <div className="flex items-center gap-1.5 text-text-muted">
                <Spinner className="w-3.5 h-3.5" />
                <span className="text-xs">Analyzing...</span>
              </div>
            )}
          </div>
          <div className="flex items-center gap-2">
            <AgentProfileSelect
              profiles={agentProfiles}
              value={profileId}
              onChange={setProfileId}
            />
            <button onClick={handleClose} className="rounded-md p-1 text-text-muted transition hover:bg-surface-300 hover:text-text-primary">
              <IconX className="h-5 w-5" />
            </button>
          </div>
        </div>

        {/* Body: optional history panel + main content */}
        <div className="flex flex-1 overflow-hidden">
          {showHistory && (
            <HistoryPanel
              history={history}
              viewingHistoryId={viewingHistoryId}
              activeSessionId={sessionId}
              onSelect={loadHistoryEntry}
              onDelete={deleteHistoryEntry}
              onBackToActive={() => loadHistoryEntry(null)}
            />
          )}

          <div className="flex flex-1 flex-col overflow-hidden">
            {/* Repo selector — only before session starts and not viewing history */}
            {!sessionId && !isViewingHistory && otherRepos.length > 0 && (
              <div className="border-b border-border-default px-5 py-2">
                <p className="mb-1.5 text-xs text-text-muted">Additional repositories for context:</p>
                <div className="flex flex-wrap gap-1.5">
                  {otherRepos.map((r) => {
                    const selected = extraRepoIds.includes(r.id);
                    return (
                      <button
                        key={r.id}
                        onClick={() => setExtraRepoIds((prev) =>
                          selected ? prev.filter((id) => id !== r.id) : [...prev, r.id],
                        )}
                        className={`rounded-md border px-2 py-0.5 text-xs transition ${
                          selected
                            ? "border-brand bg-brand/10 text-brand"
                            : "border-border-strong bg-surface-200 text-text-muted hover:border-text-muted"
                        }`}
                      >
                        {r.name}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Messages */}
            <div className="flex-1 overflow-hidden p-4">
              {filteredLogs.length === 0 ? (
                <div className="flex h-full items-center justify-center">
                  <div className="text-center">
                    <IconAnalyst className="mx-auto h-10 w-10 text-text-muted/40" />
                    <p className="mt-3 text-sm text-text-muted">
                      Describe a feature or requirement to get started.
                    </p>
                    <p className="mt-1 text-xs text-text-muted/60">
                      The analyst will ask clarifying questions and help structure a task.
                    </p>
                  </div>
                </div>
              ) : (
                <LogViewer logs={filteredLogs} className="h-full" />
              )}
            </div>

            {/* Input — hidden when viewing history */}
            {!isViewingHistory && (
              <div className="border-t border-border-default px-4 py-3">
                <div className="flex gap-2">
                  <textarea
                    ref={inputRef}
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={handleKeyDown}
                    placeholder={sessionId ? "Type your response..." : "Describe a feature or requirement..."}
                    rows={2}
                    className="flex-1 resize-none rounded-lg border border-border-strong bg-surface-300 px-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:border-brand focus:outline-none"
                  />
                  <button
                    onClick={() => void handleSend()}
                    disabled={!input.trim() || loading || !profileId}
                    className={`${btnPrimary} self-end !px-4 !py-2`}
                  >
                    {loading ? <Spinner className="w-4 h-4" /> : "Send"}
                  </button>
                </div>
                {!profileId && (
                  <p className="mt-1.5 text-xs text-status-warning">Select an agent profile to start.</p>
                )}
              </div>
            )}

            {/* Footer */}
            <div className="flex items-center justify-between border-t border-border-default px-4 py-2.5">
              <button
                onClick={handleNew}
                disabled={!sessionId && !isViewingHistory}
                className={`${btnSecondary} !px-3 !py-1.5 text-xs`}
              >
                New
              </button>
              <button
                onClick={handleCreateTask}
                disabled={!hasOutput}
                className={`${btnPrimary} !px-3 !py-1.5 text-xs`}
              >
                Create Task
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
