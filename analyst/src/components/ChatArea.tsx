import { useRef, useEffect, useCallback, useState } from "react";
import { Virtuoso, type VirtuosoHandle } from "react-virtuoso";
import type { RunLogEntry } from "../types";
import MessageBubble from "./MessageBubble";
import MessageInput from "./MessageInput";
import TypingIndicator from "./TypingIndicator";
import EmptyState from "./EmptyState";
import { IconArrowDown } from "./Icons";

const VISIBLE_TYPES = new Set(["thinking", "agent_text", "user_message", "turn_separator"]);

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
  const virtuosoRef = useRef<VirtuosoHandle>(null);
  const [atBottom, setAtBottom] = useState(true);
  const [showScrollBtn, setShowScrollBtn] = useState(false);

  const visibleLogs = logs.filter((l) => VISIBLE_TYPES.has(l.type));
  const isStreaming = hasSession && isConnected && !isFinished;

  const scrollToBottom = useCallback(() => {
    virtuosoRef.current?.scrollToIndex({ index: "LAST", behavior: "smooth" });
  }, []);

  // Auto-scroll on new messages if user is at bottom
  useEffect(() => {
    if (atBottom && visibleLogs.length > 0) {
      virtuosoRef.current?.scrollToIndex({ index: "LAST", behavior: "smooth" });
    }
  }, [visibleLogs.length, atBottom]);

  // Show/hide scroll-to-bottom button
  useEffect(() => {
    setShowScrollBtn(!atBottom && visibleLogs.length > 5);
  }, [atBottom, visibleLogs.length]);

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
      <div className="flex-1 min-h-0">
        <Virtuoso
          ref={virtuosoRef}
          data={visibleLogs}
          atBottomStateChange={setAtBottom}
          atBottomThreshold={80}
          followOutput="smooth"
          className="h-full"
          itemContent={(_index, entry) => (
            <div className="max-w-3xl mx-auto px-4 py-1.5">
              <MessageBubble entry={entry} />
            </div>
          )}
          components={{
            Footer: () => isStreaming ? (
              <div className="max-w-3xl mx-auto px-4 pb-2">
                <TypingIndicator />
              </div>
            ) : null,
          }}
        />
      </div>

      {/* Scroll to bottom FAB */}
      {showScrollBtn && (
        <button
          onClick={scrollToBottom}
          className="absolute bottom-24 right-6 w-8 h-8 rounded-full bg-surface-300 border border-border-strong shadow-md flex items-center justify-center text-text-secondary hover:text-text-primary hover:bg-surface-400 transition-all animate-fade-in"
        >
          <IconArrowDown />
        </button>
      )}

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
