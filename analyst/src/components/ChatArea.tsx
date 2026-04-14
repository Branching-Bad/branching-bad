import type { RunLogEntry } from "../types";
import AnalystChat from "./AnalystChat";
import MessageInput from "./MessageInput";
import EmptyState from "./EmptyState";

const VISIBLE_TYPES = new Set(["thinking", "agent_text", "user_message", "turn_separator", "tool_use", "tool_result", "agent_done"]);

interface Props {
  logs: RunLogEntry[];
  isConnected: boolean;
  isFinished: boolean;
  loading: boolean;
  hasSession: boolean;
  viewingHistory: boolean;
  onSend: (message: string) => void;
  inputRef: React.RefObject<HTMLTextAreaElement | null>;
}

export default function ChatArea({
  logs, isConnected, isFinished, loading,
  hasSession, viewingHistory, onSend, inputRef,
}: Props) {
  const visibleLogs = logs.filter((l) => VISIBLE_TYPES.has(l.type));
  const isStreaming = hasSession && isConnected && !isFinished;

  // No session — show empty state
  if (!hasSession && visibleLogs.length === 0) {
    return (
      <div className="flex-1 flex flex-col h-screen">
        <EmptyState variant="no-session" />
        <div className="p-4 pt-0 pb-6 max-w-3xl w-full mx-auto">
          <MessageInput onSend={onSend} disabled={loading} inputRef={inputRef} />
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col h-screen relative">
      {/* Connection status bar */}
      {hasSession && !viewingHistory && (
        <div className="px-4 py-2 border-b border-border-default flex items-center gap-2 bg-surface-100/80 backdrop-blur-sm">
          <span className={`w-1.5 h-1.5 rounded-full ${
            isConnected ? "bg-status-success" : isFinished ? "bg-text-muted" : "bg-status-warning animate-pulse"
          }`} />
          <span className="text-[11px] text-text-muted">
            {isConnected ? "Connected" : isFinished ? "Session complete" : "Connecting..."}
          </span>
        </div>
      )}

      {viewingHistory && (
        <div className="px-4 py-2 border-b border-border-default bg-surface-100/80 backdrop-blur-sm">
          <span className="text-[11px] text-text-muted">Viewing archived session</span>
        </div>
      )}

      {/* Messages */}
      <div className="flex-1 min-h-0 overflow-hidden">
        {visibleLogs.length > 0 ? (
          <AnalystChat logs={visibleLogs} className="h-full" isStreaming={isStreaming || loading} />
        ) : (
          <div className="flex h-full items-center justify-center">
            <div className="text-center">
              <div className="mx-auto w-10 h-10 rounded-xl bg-surface-300 border border-border-default flex items-center justify-center mb-3">
                <svg className="w-5 h-5 text-text-muted/40" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                  <circle cx="12" cy="12" r="10" />
                  <path d="M12 6v6l4 2" />
                </svg>
              </div>
              <p className="text-sm text-text-muted">
                {loading ? "Starting analysis..." : "Waiting for response..."}
              </p>
            </div>
          </div>
        )}
      </div>

      {/* Input area */}
      {!viewingHistory && (
        <div className="p-4 pt-2 pb-6 max-w-3xl w-full mx-auto">
          <MessageInput
            onSend={onSend}
            disabled={loading || (hasSession && !isConnected && !isFinished)}
            placeholder={hasSession ? "Send a follow-up..." : "Describe a task, feature, or bug..."}
            inputRef={inputRef}
          />
          <div className="flex items-center justify-between mt-2 px-1">
            <span className="text-[10px] text-text-muted">
              Enter to send, Shift+Enter for newline
            </span>
            <span className="text-[10px] text-text-muted">
              {navigator.platform.includes("Mac") ? "\u2318" : "Ctrl"}+Enter to send
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
