import { useState, useRef, useEffect } from "react";
import type { ChatMessage, AgentProfile } from "../types";
import { AgentProfileSelect } from "./AgentProfileSelect";
import { formatDate } from "./shared";

export function ChatPanel({
  isRunning,
  onSend,
  onCancelQueued,
  messages,
  queuedCount,
  agentProfiles,
  chatProfileId,
  onChatProfileChange,
}: {
  isRunning: boolean;
  onSend: (content: string) => Promise<void>;
  onCancelQueued: () => Promise<void>;
  messages: ChatMessage[];
  queuedCount: number;
  agentProfiles?: AgentProfile[];
  chatProfileId?: string;
  onChatProfileChange?: (v: string) => void;
}) {
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length]);

  const handleSend = async () => {
    const text = input.trim();
    if (!text || sending) return;
    setSending(true);
    try {
      await onSend(text);
      setInput("");
    } finally {
      setSending(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void handleSend();
    }
  };

  return (
    <div className="rounded-xl border border-border-default bg-surface-200 p-3 flex flex-col gap-2">
      <h4 className="text-xs font-medium text-text-secondary flex items-center justify-between">
        <span>Follow-up Chat</span>
        {queuedCount > 0 && (
          <span className="flex items-center gap-1.5">
            <span className="rounded-full bg-amber-500/20 border border-amber-500/30 px-2 py-0.5 text-[10px] text-amber-400">
              {queuedCount} queued
            </span>
            <button
              onClick={() => void onCancelQueued()}
              className="text-[10px] text-red-400 hover:text-red-300 transition"
            >
              Cancel
            </button>
          </span>
        )}
      </h4>

      {messages.length > 0 && (
        <div className="max-h-[200px] overflow-y-auto space-y-2 scrollbar-thin">
          {messages.map((msg) => (
            <div
              key={msg.id}
              className={`rounded-lg px-3 py-2 text-xs ${
                msg.role === "user"
                  ? "bg-blue-500/10 border border-blue-500/20 text-blue-200"
                  : "bg-surface-300 border border-border-strong text-text-secondary"
              }`}
            >
              <div className="flex items-center gap-1.5 mb-1">
                <span className="font-medium text-[10px] uppercase tracking-wide opacity-60">
                  {msg.role === "user" ? "You" : "Agent"}
                </span>
                <span className="text-[10px] opacity-40">{formatDate(msg.created_at)}</span>
                {msg.status === "queued" && (
                  <span className="rounded-full bg-amber-500/20 px-1.5 py-0.5 text-[9px] text-amber-400">
                    queued
                  </span>
                )}
                {msg.status === "dispatched" && msg.result_run_id && (
                  <span className="rounded-full bg-green-500/20 px-1.5 py-0.5 text-[9px] text-green-400">
                    dispatched
                  </span>
                )}
              </div>
              <p className="whitespace-pre-wrap">{msg.content}</p>
            </div>
          ))}
          <div ref={messagesEndRef} />
        </div>
      )}

      <div className="flex gap-2">
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Send a follow-up message..."
          rows={1}
          className="flex-1 resize-none rounded-lg border border-border-strong bg-surface-100 px-3 py-2 text-xs text-text-primary placeholder:text-text-muted focus:border-brand focus:outline-none"
        />
        {agentProfiles && onChatProfileChange && (
          <AgentProfileSelect
            profiles={agentProfiles}
            value={chatProfileId ?? ""}
            onChange={onChatProfileChange}
            className="shrink-0 rounded-lg border border-border-strong bg-surface-100 px-2 py-2 text-[11px] text-text-secondary focus:border-brand focus:outline-none"
          />
        )}
        <button
          onClick={() => void handleSend()}
          disabled={!input.trim() || sending}
          className="shrink-0 rounded-lg bg-brand px-3 py-2 text-xs font-medium text-white transition hover:brightness-110 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          Send
        </button>
      </div>

      {isRunning && (
        <p className="text-[10px] text-amber-400/80">
          Agent is running — message will be queued and dispatched when the run finishes.
        </p>
      )}
    </div>
  );
}
