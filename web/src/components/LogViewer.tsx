import { useRef, useState, useCallback, useEffect } from "react";
import { Virtuoso, type VirtuosoHandle } from "react-virtuoso";
import type { RunLogEntry } from "../types";
import { LogEntry } from "./LogEntry";

export function LogViewer({
  logs,
  className = "",
  emptyMessage = "No output yet.",
}: {
  logs: RunLogEntry[];
  className?: string;
  emptyMessage?: string;
}) {
  const virtuosoRef = useRef<VirtuosoHandle>(null);
  const [atBottom, setAtBottom] = useState(true);
  const [unreadCount, setUnreadCount] = useState(0);
  const prevCountRef = useRef(logs.length);

  useEffect(() => {
    if (!atBottom && logs.length > prevCountRef.current) {
      setUnreadCount((prev) => prev + (logs.length - prevCountRef.current));
    }
    prevCountRef.current = logs.length;
  }, [logs.length, atBottom]);

  const handleAtBottomChange = useCallback((bottom: boolean) => {
    setAtBottom(bottom);
    if (bottom) {
      setUnreadCount(0);
    }
  }, []);

  const scrollToBottom = useCallback(() => {
    virtuosoRef.current?.scrollToIndex({ index: "LAST", align: "end", behavior: "smooth" });
    setUnreadCount(0);
  }, []);

  if (logs.length === 0) {
    return (
      <div className={`rounded-lg border border-border-strong bg-surface-0 px-3 py-2 text-[11px] leading-relaxed ${className}`}>
        <p className="py-8 text-center text-text-muted">{emptyMessage}</p>
      </div>
    );
  }

  return (
    <div className={`relative rounded-lg border border-border-strong bg-surface-0 text-[11px] leading-relaxed ${className}`}>
      <Virtuoso
        ref={virtuosoRef}
        data={logs}
        increaseViewportBy={{ top: 200, bottom: 400 }}
        followOutput={atBottom ? "smooth" : false}
        atBottomStateChange={handleAtBottomChange}
        itemContent={(_index, entry) => (
          <div className="px-3 py-1">
            <LogEntry type={entry.type} data={entry.data} />
          </div>
        )}
        style={{ height: "100%" }}
      />
      {!atBottom && (
        <button
          onClick={scrollToBottom}
          className="absolute bottom-3 right-3 flex items-center gap-1.5 rounded-full border border-border-strong bg-surface-300/90 px-3 py-1.5 text-[11px] font-medium text-text-secondary shadow-lg backdrop-blur-sm transition hover:bg-surface-400 hover:text-text-primary"
        >
          <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 13.5 12 21m0 0-7.5-7.5M12 21V3" />
          </svg>
          Scroll to bottom
          {unreadCount > 0 && (
            <span className="ml-1 inline-flex h-4 min-w-[16px] items-center justify-center rounded-full bg-brand px-1 text-[10px] font-semibold text-white">
              {unreadCount > 99 ? "99+" : unreadCount}
            </span>
          )}
        </button>
      )}
    </div>
  );
}
