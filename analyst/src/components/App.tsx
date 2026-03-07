import { useRef, useCallback } from "react";
import { useAnalystState } from "../hooks/useAnalystState";
import { useKeyboard } from "../hooks/useKeyboard";
import Sidebar from "./Sidebar";
import ChatArea from "./ChatArea";
import EmptyState from "./EmptyState";

export default function App() {
  const state = useAnalystState();
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const handleSend = useCallback((message: string) => {
    if (state.sessionId) {
      state.sendMessage(message);
    } else {
      state.startSession(message);
    }
  }, [state]);

  const handleSendFromKeyboard = useCallback(() => {
    const el = inputRef.current;
    if (!el) return;
    const text = el.value.trim();
    if (!text) return;
    handleSend(text);
    el.value = "";
    el.style.height = "auto";
  }, [handleSend]);

  const handleNewSession = useCallback(() => {
    state.archiveAndReset();
    setTimeout(() => inputRef.current?.focus(), 50);
  }, [state]);

  const handleEscape = useCallback(() => {
    if (state.viewingHistoryId) {
      state.loadHistoryEntry(null);
    }
  }, [state]);

  useKeyboard({
    onNewSession: handleNewSession,
    onSend: handleSendFromKeyboard,
    onEscape: handleEscape,
  });

  if (!state.booted) {
    return (
      <div className="h-screen flex items-center justify-center bg-surface-0">
        <div className="flex items-center gap-3 text-text-muted animate-fade-in">
          <div className="w-5 h-5 border-2 border-brand/30 border-t-brand rounded-full animate-spin" />
          <span className="text-sm">Loading...</span>
        </div>
      </div>
    );
  }

  if (state.repos.length === 0) {
    return (
      <div className="h-screen flex items-center justify-center bg-surface-0">
        <EmptyState variant="no-repo" />
      </div>
    );
  }

  // When viewing history, show those logs; otherwise show live logs
  const viewingEntry = state.viewingHistoryId
    ? state.history.find((h) => h.id === state.viewingHistoryId)
    : null;
  const displayLogs = viewingEntry ? viewingEntry.logs : state.logs;

  return (
    <div className="flex h-screen bg-surface-0">
      <Sidebar
        repos={state.repos}
        profiles={state.profiles}
        selectedRepoId={state.repoId}
        selectedProfileId={state.profileId}
        onRepoChange={state.setRepoId}
        onProfileChange={state.setProfileId}
        onNewSession={handleNewSession}
        history={state.history}
        viewingHistoryId={state.viewingHistoryId}
        activeSessionId={state.sessionId}
        onSelectHistory={state.loadHistoryEntry}
        onDeleteHistory={state.deleteHistoryEntry}
      />
      <ChatArea
        logs={displayLogs}
        isConnected={state.isConnected}
        isFinished={state.isFinished}
        loading={state.loading}
        hasSession={!!state.sessionId}
        viewingHistory={!!state.viewingHistoryId}
        onSend={handleSend}
        inputRef={inputRef}
      />
    </div>
  );
}
