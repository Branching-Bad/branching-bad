import { useState, useRef, useEffect, useCallback } from "react";
import type { AgentProfile, Repo, RunLogEntry } from "../types";
import { IconX, IconAnalyst } from "./icons";
import { AgentProfileSelect } from "./AgentProfileSelect";
import { LogViewer } from "./LogViewer";
import { btnPrimary, btnSecondary } from "./shared";

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
    startSession: (repoId: string, message: string, additionalRepoIds?: string[]) => Promise<void>;
    sendMessage: (content: string) => Promise<void>;
    closeSession: () => Promise<void>;
    extractTaskFields: () => { title: string; description: string } | null;
  };
}) {
  const [input, setInput] = useState("");
  const [extraRepoIds, setExtraRepoIds] = useState<string[]>([]);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const {
    sessionId, profileId, setProfileId, loading, logs,
    startSession, sendMessage, closeSession, extractTaskFields,
  } = analystState;
  const otherRepos = repos.filter((r) => r.id !== repoId);

  // Focus input when modal opens
  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 100);
  }, [open]);

  const handleSend = useCallback(async () => {
    const text = input.trim();
    if (!text || loading) return;
    setInput("");
    if (!sessionId) {
      await startSession(repoId, text, extraRepoIds.length ? extraRepoIds : undefined);
    } else {
      await sendMessage(text);
    }
  }, [input, loading, sessionId, repoId, extraRepoIds, startSession, sendMessage]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void handleSend();
    }
  };

  const handleClose = () => {
    void closeSession();
    setInput("");
    onClose();
  };

  const handleCreateTask = () => {
    const fields = extractTaskFields();
    if (fields) {
      onCreateTask(fields);
      handleClose();
    }
  };

  const handleClear = () => {
    void closeSession();
    setInput("");
    setExtraRepoIds([]);
  };

  const ANALYST_VISIBLE_TYPES = new Set(["thinking", "agent_text", "user_message", "turn_separator"]);
  const filteredLogs = logs.filter((l) => ANALYST_VISIBLE_TYPES.has(l.type));

  const hasOutput = logs.some(
    (l) => l.type === "agent_text" && l.data.includes("---TASK_OUTPUT_START---"),
  );

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={handleClose} />
      <div className="relative flex h-[80vh] w-full max-w-3xl flex-col rounded-2xl border border-border-default bg-surface-100 shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border-default px-5 py-3">
          <div className="flex items-center gap-2.5">
            <IconAnalyst className="w-5 h-5 text-orange-500" />
            <h3 className="text-sm font-medium text-text-primary">Task Analyst</h3>
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

        {/* Repo selector — only before session starts */}
        {!sessionId && otherRepos.length > 0 && (
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

        {/* Input */}
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
              {loading ? "..." : "Send"}
            </button>
          </div>
          {!profileId && (
            <p className="mt-1.5 text-xs text-status-warning">Select an agent profile to start.</p>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between border-t border-border-default px-4 py-2.5">
          <button
            onClick={handleClear}
            disabled={!sessionId}
            className={`${btnSecondary} !px-3 !py-1.5 text-xs`}
          >
            Clear
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
  );
}
