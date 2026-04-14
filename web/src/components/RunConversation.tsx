import { useEffect, useRef, useState, type FC } from "react";
import type {
  Task, RunLogEntry, RunResponse, ActiveRun,
  ChatMessage, AgentProfile, Plan,
} from "../types";
import { LogEntry } from "./LogEntry";
import { AgentProfileSelect } from "./AgentProfileSelect";
import { IconPlay, IconGitBranch } from "./icons";
import { runStatusColor } from "./shared";

interface Props {
  selectedProfile: AgentProfile | null;
  selectedProfileId: string;
  taskRequiresPlan: boolean;
  approvedPlan: Plan | null;
  activeRun: ActiveRun | null;
  runLogs: RunLogEntry[];
  runFinished: boolean;
  runResult: RunResponse | null;
  selectedTask: Task;
  customBranchName: string;
  setCustomBranchName: (v: string) => void;
  chatMessages: ChatMessage[];
  chatQueuedCount: number;
  busy: boolean;
  onStartRun: () => void;
  onResumeRun: () => void;
  onStopRun: () => void;
  onSendChat: (content: string) => Promise<void>;
  onCancelQueuedChat: () => Promise<void>;
  agentProfiles?: AgentProfile[];
  chatProfileId?: string;
  onChatProfileChange?: (v: string) => void;
}

function formatHM(iso: string): string {
  try { return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }); }
  catch { return ""; }
}

const HIDDEN_DB_EVENTS = new Set(["tasklist_progress", "working_tree_diff", "run_finished"]);
function isHiddenDbEvent(entry: RunLogEntry): boolean {
  if (entry.type !== "db_event") return false;
  try {
    const parsed = JSON.parse(entry.data) as { type?: string };
    return HIDDEN_DB_EVENTS.has(parsed.type ?? "");
  } catch { return false; }
}

export const RunConversation: FC<Props> = ({
  selectedProfile, selectedProfileId, taskRequiresPlan, approvedPlan,
  activeRun, runLogs, runFinished, runResult,
  selectedTask, customBranchName, setCustomBranchName,
  chatMessages, chatQueuedCount, busy,
  onStartRun, onResumeRun, onStopRun,
  onSendChat, onCancelQueuedChat,
  agentProfiles, chatProfileId, onChatProfileChange,
}) => {
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Autoscroll when logs or messages grow
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [runLogs.length, chatMessages.length]);

  const isRunning = !!activeRun && !runFinished;
  const blockedByPlan = taskRequiresPlan && !approvedPlan;
  const canStart = !busy && !!selectedProfileId && !blockedByPlan;
  const canResume = !busy && !!selectedProfileId && !!activeRun?.agent_session_id && activeRun.status !== "running";

  const handleSend = async () => {
    const text = input.trim();
    if (!text || sending) return;
    setSending(true);
    try {
      await onSendChat(text);
      setInput("");
      composerRef.current?.focus();
    } finally {
      setSending(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      void handleSend();
    }
  };

  const hasAnyActivity = runLogs.length > 0 || chatMessages.length > 0;

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      {/* ── Toolbar strip ──────────────────────────────────── */}
      <header className="rounded-[var(--radius-lg)] border border-border-default bg-surface-100/70 px-3 py-2 backdrop-blur-sm">
        <div className="flex flex-wrap items-center gap-2">
          {/* Agent / model */}
          <div className="flex min-w-0 items-center gap-1.5 text-[11px]">
            <span className="h-1.5 w-1.5 rounded-full bg-brand" />
            <span className="truncate text-text-primary">
              {selectedProfile ? selectedProfile.agent_name : "No agent"}
              {selectedProfile && <span className="text-text-muted"> · {selectedProfile.model}</span>}
            </span>
          </div>

          {/* Status chips */}
          {blockedByPlan && (
            <span className="rounded-full bg-status-caution-soft px-2 py-0.5 text-[10px] font-medium text-status-caution">
              Plan approval required
            </span>
          )}
          {!taskRequiresPlan && (
            <span className="rounded-full bg-brand-tint px-2 py-0.5 text-[10px] font-medium text-brand">
              Direct run
            </span>
          )}
          {activeRun && (
            <span className={`rounded-full border px-2 py-0.5 text-[10px] font-medium ${runStatusColor(activeRun.status)}`}>
              {activeRun.status}
            </span>
          )}
          {activeRun?.branch_name && (
            <span className="inline-flex items-center gap-1 rounded-full bg-surface-200 px-2 py-0.5 text-[10px] text-text-secondary">
              <IconGitBranch className="h-2.5 w-2.5" />
              <span className="max-w-[120px] truncate">{activeRun.branch_name}</span>
            </span>
          )}

          {/* Actions (right) */}
          <div className="ml-auto flex items-center gap-1.5">
            {isRunning ? (
              <button
                onClick={onStopRun}
                className="flex items-center gap-1.5 rounded-full bg-status-danger-soft px-3 py-1 text-[11px] font-medium text-status-danger transition hover:bg-status-danger/20"
              >
                <svg className="h-2.5 w-2.5" viewBox="0 0 12 12" fill="currentColor">
                  <rect x="2.5" y="2.5" width="7" height="7" rx="1" />
                </svg>
                Stop
              </button>
            ) : (
              <>
                {activeRun?.agent_session_id && (
                  <button
                    onClick={onResumeRun}
                    disabled={!canResume}
                    className="flex items-center gap-1.5 rounded-full border border-border-default bg-surface-200 px-3 py-1 text-[11px] font-medium text-text-secondary transition hover:bg-surface-300 hover:text-text-primary disabled:opacity-40"
                    title="Resume previous agent session"
                  >
                    <IconPlay className="h-2.5 w-2.5" />
                    Resume
                  </button>
                )}
                <button
                  onClick={onStartRun}
                  disabled={!canStart}
                  className="flex items-center gap-1.5 rounded-full bg-brand px-3 py-1 text-[11px] font-semibold text-white shadow-[0_1px_2px_rgba(0,0,0,0.2)] transition hover:bg-brand-dark disabled:opacity-40 disabled:hover:bg-brand"
                  title="Start a fresh run"
                >
                  <IconPlay className="h-2.5 w-2.5" />
                  {activeRun ? "New run" : "Run"}
                </button>
              </>
            )}
          </div>
        </div>

        {/* Branch name hint (only pre-run worktree tasks) */}
        {selectedTask.use_worktree && !activeRun && (
          <div className="mt-2">
            <input
              value={customBranchName}
              onChange={(e) => setCustomBranchName(e.target.value)}
              placeholder="Branch name (auto-generated if empty)"
              className="w-full rounded-[var(--radius-md)] border border-border-default bg-surface-200 px-2.5 py-1 text-[11px] font-mono text-text-primary placeholder:text-text-muted focus:border-border-focus focus:outline-none focus:shadow-[0_0_0_3px_var(--color-brand-glow)]"
            />
          </div>
        )}

        {/* Completion summary (when finished) */}
        {runResult && runFinished && runResult.events.length > 0 && (
          <div className="mt-2 text-[10px] text-text-muted">
            {runResult.events.length} event{runResult.events.length === 1 ? "" : "s"} recorded
          </div>
        )}
      </header>

      {/* ── Unified conversation stream ────────────────────── */}
      <div
        ref={scrollRef}
        className="flex min-h-0 flex-1 flex-col overflow-y-auto rounded-[var(--radius-lg)] border border-border-default bg-surface-0/40"
      >
        <div className="flex-1 px-3 py-3">
          {!hasAnyActivity ? (
            <EmptyPrompt isRunning={isRunning} canStart={canStart} blockedByPlan={blockedByPlan} />
          ) : (
            <>
              <div className="space-y-1">
                {runLogs
                  .filter((l) => !isHiddenDbEvent(l))
                  .map((log, i) => (
                    <LogEntry key={i} type={log.type} data={log.data} />
                  ))}
              </div>
              {chatMessages.map((msg) => (
                <ChatBubble key={msg.id} msg={msg} />
              ))}
              {isRunning && (
                <TypingIndicator />
              )}
            </>
          )}
        </div>
      </div>

      {/* ── Composer ───────────────────────────────────────── */}
      <div className="rounded-[var(--radius-xl)] border border-border-default bg-surface-100/70 p-2 transition backdrop-blur-sm focus-within:border-border-focus focus-within:shadow-[0_0_0_3px_var(--color-brand-glow)]">
        {/* Queued banner */}
        {chatQueuedCount > 0 && (
          <div className="mb-2 flex items-center gap-2 rounded-[var(--radius-md)] bg-status-warning-soft px-2.5 py-1 text-[11px] text-status-warning">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-status-warning" />
            {chatQueuedCount} message{chatQueuedCount === 1 ? "" : "s"} queued — will dispatch when run completes
            <button
              onClick={() => void onCancelQueuedChat()}
              className="ml-auto rounded-full bg-status-danger-soft px-2 py-0.5 text-[10px] text-status-danger transition hover:bg-status-danger/20"
            >
              Cancel
            </button>
          </div>
        )}

        <textarea
          ref={composerRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={
            !activeRun
              ? "Follow-up will start after Run is triggered…"
              : isRunning
              ? "Queue a follow-up (⌘/Ctrl + Enter to send)…"
              : "Send a follow-up to re-open this session…"
          }
          rows={3}
          className="w-full resize-none bg-transparent px-2 py-1 text-[13px] leading-relaxed text-text-primary placeholder:text-text-muted focus:outline-none"
        />

        <div className="flex items-center gap-2 border-t border-border-default/60 pt-2">
          {agentProfiles && onChatProfileChange && (
            <AgentProfileSelect
              profiles={agentProfiles}
              value={chatProfileId ?? ""}
              onChange={onChatProfileChange}
              className="flex-1 rounded-full border border-border-default bg-surface-200 px-2.5 py-1 text-[11px] text-text-secondary focus:border-border-focus focus:outline-none"
            />
          )}
          <span className="hidden md:inline text-[10px] text-text-muted">
            ⌘/Ctrl + Enter
          </span>
          <button
            onClick={() => void handleSend()}
            disabled={!input.trim() || sending || !activeRun}
            aria-label="Send message"
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand text-white shadow-[0_1px_2px_rgba(0,0,0,0.2)] transition hover:bg-brand-dark disabled:bg-surface-300 disabled:text-text-muted disabled:hover:bg-surface-300"
          >
            <svg className="h-3.5 w-3.5" viewBox="0 0 14 14" fill="none">
              <path
                d="M2 7h10M8 3l4 4-4 4"
                stroke="currentColor" strokeWidth="1.6"
                strokeLinecap="round" strokeLinejoin="round"
              />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// Pieces
// ─────────────────────────────────────────────────────────────────────────────

const ChatBubble: FC<{ msg: ChatMessage }> = ({ msg }) => {
  const isUser = msg.role === "user";
  return (
    <div className={`mt-2 flex ${isUser ? "justify-end" : "justify-start"}`}>
      <div
        className={`max-w-[80%] rounded-[var(--radius-lg)] px-3 py-2 text-[12px] leading-relaxed ${
          isUser
            ? "bg-brand-tint text-text-primary"
            : "bg-surface-200 text-text-secondary"
        }`}
      >
        <div className="mb-0.5 flex items-center gap-1.5 text-[10px]">
          <span className={`font-medium uppercase tracking-[0.08em] ${isUser ? "text-brand" : "text-text-muted"}`}>
            {isUser ? "You" : "Agent"}
          </span>
          <span className="text-text-muted/60">{formatHM(msg.created_at)}</span>
          {msg.status === "queued" && (
            <span className="rounded-full bg-status-warning-soft px-1.5 text-[9px] font-medium text-status-warning">
              queued
            </span>
          )}
          {msg.status === "dispatched" && (
            <span className="rounded-full bg-status-success-soft px-1.5 text-[9px] font-medium text-status-success">
              dispatched
            </span>
          )}
        </div>
        <p className="whitespace-pre-wrap">{msg.content}</p>
      </div>
    </div>
  );
};

const TypingIndicator: FC = () => (
  <div className="mt-2 flex items-center gap-1 px-1">
    <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-brand [animation-delay:0ms]" />
    <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-brand [animation-delay:150ms]" />
    <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-brand [animation-delay:300ms]" />
    <span className="ml-1 text-[10px] text-text-muted">agent working…</span>
  </div>
);

const EmptyPrompt: FC<{ isRunning: boolean; canStart: boolean; blockedByPlan: boolean }> = ({ canStart, blockedByPlan }) => (
  <div className="flex h-full min-h-[200px] items-center justify-center">
    <div className="max-w-xs text-center">
      <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-brand-tint">
        <IconPlay className="h-4 w-4 text-brand" />
      </div>
      {blockedByPlan ? (
        <>
          <p className="text-[12px] font-medium text-text-primary">Approve a plan to run</p>
          <p className="mt-1 text-[11px] leading-relaxed text-text-muted">
            This task requires a reviewed plan before execution.
          </p>
        </>
      ) : canStart ? (
        <>
          <p className="text-[12px] font-medium text-text-primary">Ready to run</p>
          <p className="mt-1 text-[11px] leading-relaxed text-text-muted">
            Click Run to start the agent. Live output and your follow-up messages will appear here.
          </p>
        </>
      ) : (
        <>
          <p className="text-[12px] font-medium text-text-primary">Pick an agent / model</p>
          <p className="mt-1 text-[11px] leading-relaxed text-text-muted">
            Select an agent profile in repo settings to enable runs.
          </p>
        </>
      )}
    </div>
  </div>
);
