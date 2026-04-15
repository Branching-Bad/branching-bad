import { useEffect, useRef, useState } from "react";
import type { AgentProfile, Repo } from "../types";
import { LogEntry } from "../components/LogEntry";
import { AgentProfileSelect } from "../components/AgentProfileSelect";
import type { UseChatRepl } from "../hooks/useChatRepl";

export function ChatView({
  chat,
  repos,
  selectedRepoId,
  agentProfiles,
  setInfo,
  setError,
}: {
  chat: UseChatRepl;
  repos: Repo[];
  selectedRepoId: string;
  agentProfiles: AgentProfile[];
  setInfo: (m: string) => void;
  setError: (m: string) => void;
}) {
  const [input, setInput] = useState("");
  const [memoryBusy, setMemoryBusy] = useState(false);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const taRef = useRef<HTMLTextAreaElement | null>(null);

  const viewingEntry = chat.viewingHistoryId
    ? chat.history.find((h) => h.id === chat.viewingHistoryId) ?? null
    : null;
  const shownLogs = viewingEntry ? viewingEntry.logs : chat.logs;

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [shownLogs.length]);

  const selectedRepo = repos.find((r) => r.id === selectedRepoId) ?? null;
  const canStart = Boolean(selectedRepoId && chat.profileId && input.trim());
  const canSend = Boolean(chat.sessionId && chat.profileId && input.trim() && !chat.loading);

  const handleSubmit = async () => {
    const text = input.trim();
    if (!text) return;
    setInput("");
    try {
      if (!chat.sessionId) {
        if (!selectedRepoId) { setError("Select a repo first."); return; }
        if (!chat.profileId) { setError("Select an agent profile."); return; }
        await chat.startSession(selectedRepoId, text);
      } else {
        await chat.sendMessage(text);
      }
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const handleKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (!chat.sessionId ? canStart : canSend) void handleSubmit();
    }
  };

  const handleCreateMemory = async () => {
    if (!chat.sessionId || memoryBusy) return;
    setMemoryBusy(true);
    try {
      const res = await chat.createMemory();
      if (res) setInfo(`Memory saved: ${res.title}`);
      else setError("Could not summarise session.");
    } finally {
      setMemoryBusy(false);
    }
  };

  return (
    <section className="flex h-full">
      {/* Left: history */}
      <aside className="w-64 shrink-0 border-r border-border-default bg-surface-100 flex flex-col">
        <div className="border-b border-border-default p-3">
          <button
            onClick={() => void chat.archiveAndReset()}
            className="w-full rounded-md bg-brand px-3 py-2 text-[12px] font-medium text-white hover:bg-brand/90"
          >
            + New Chat
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-2 space-y-1">
          {chat.sessionId && !chat.viewingHistoryId && (
            <div className="rounded-md border border-brand/40 bg-brand-tint px-2 py-1.5 text-[11px] text-text-primary">
              <div className="text-[10px] uppercase tracking-wider text-brand mb-0.5">Current</div>
              <div className="truncate">
                {chat.logs.find((l) => l.type === "user_message")?.data.slice(0, 60) ?? "…"}
              </div>
            </div>
          )}
          {chat.history.map((h) => (
            <button
              key={h.id}
              onClick={() => void chat.loadHistoryEntry(h.id)}
              className={`group w-full rounded-md px-2 py-1.5 text-left text-[11px] transition ${
                chat.viewingHistoryId === h.id
                  ? "border border-brand/40 bg-brand-tint text-text-primary"
                  : "border border-transparent hover:bg-surface-200"
              }`}
            >
              <div className="truncate font-medium">{h.title ?? h.firstMessage}</div>
              <div className="flex items-center justify-between">
                <span className="text-[10px] text-text-muted">
                  {new Date(h.timestamp).toLocaleDateString()}
                </span>
                <span
                  role="button"
                  tabIndex={0}
                  onClick={(e) => { e.stopPropagation(); void chat.deleteHistoryEntry(h.id); }}
                  onKeyDown={(e) => { if (e.key === "Enter") { e.stopPropagation(); void chat.deleteHistoryEntry(h.id); } }}
                  className="hidden group-hover:inline text-[10px] text-status-danger hover:underline"
                >
                  delete
                </span>
              </div>
            </button>
          ))}
          {chat.historyLoaded && chat.history.length === 0 && !chat.sessionId && (
            <p className="py-4 text-center text-[11px] text-text-muted">No chats yet.</p>
          )}
        </div>
      </aside>

      {/* Right: chat pane */}
      <div className="flex flex-1 flex-col min-w-0">
        <header className="flex items-center justify-between border-b border-border-default px-6 py-3">
          <div className="min-w-0">
            <h2 className="truncate text-[13px] font-semibold text-text-primary">
              {viewingEntry ? (viewingEntry.title ?? viewingEntry.firstMessage) : "Chat"}
            </h2>
            <p className="truncate text-[11px] text-text-muted">
              {selectedRepo ? selectedRepo.name : "No repo selected"}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <AgentProfileSelect
              profiles={agentProfiles}
              value={chat.profileId}
              onChange={chat.setProfileId}
            />
            {chat.sessionId && !viewingEntry && (
              <>
                {chat.loading && (
                  <button
                    onClick={() => void chat.stopCurrent()}
                    className="rounded-md bg-status-warning/10 px-2.5 py-1 text-[11px] font-medium text-status-warning hover:bg-status-warning/20"
                  >
                    Stop
                  </button>
                )}
                <button
                  onClick={() => void handleCreateMemory()}
                  disabled={memoryBusy || chat.loading}
                  className="rounded-md border border-border-strong bg-surface-200 px-2.5 py-1 text-[11px] font-medium text-text-primary hover:bg-surface-300 disabled:opacity-50"
                  title="Distil this chat into a ~200-word memory"
                >
                  {memoryBusy ? "Saving…" : "Save as Memory"}
                </button>
              </>
            )}
          </div>
        </header>

        <div
          ref={scrollRef}
          className="flex-1 overflow-y-auto bg-[#0b0f14] px-6 py-4 font-mono text-[12px]"
        >
          {shownLogs.length === 0 && !chat.sessionId && (
            <div className="text-text-muted">
              <p>New chat. The agent will work directly in the repo — no branch, no worktree.</p>
              <p className="mt-2 text-[11px]">Memory + glossary context is appended to every message automatically.</p>
            </div>
          )}
          {shownLogs.map((entry, idx) => (
            <LogEntry key={idx} type={entry.type} data={entry.data} />
          ))}
          {chat.loading && !viewingEntry && (
            <div className="mt-2 text-text-muted animate-pulse">…</div>
          )}
        </div>

        {!viewingEntry && (
          <div className="border-t border-border-default bg-surface-100 p-3">
            <textarea
              ref={taRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKey}
              placeholder={chat.sessionId ? "Message…  (Enter to send, Shift+Enter newline)" : "Start a new chat…"}
              rows={3}
              className="w-full resize-none rounded-md border border-border-default bg-surface-200 px-3 py-2 text-[13px] text-text-primary placeholder:text-text-muted focus:border-brand focus:outline-none"
            />
            <div className="mt-2 flex items-center justify-end gap-2 text-[11px]">
              <button
                onClick={() => void handleSubmit()}
                disabled={!chat.sessionId ? !canStart : !canSend}
                className="rounded-md bg-brand px-3 py-1.5 font-medium text-white disabled:opacity-50"
              >
                {chat.sessionId ? "Send" : "Start Chat"}
              </button>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
