import { useState, useMemo, useCallback, useEffect } from "react";
import { api } from "../api";
import type { ChatMessage, ActiveRun, TaskRunState } from "../types";
import type { StreamFunctions } from "./streamTypes";

export function useChatState({
  selectedTaskId,
  selectedRepoId,
  streamRef,
  updateTaskRunState,
  setError,
}: {
  selectedTaskId: string;
  selectedRepoId: string;
  streamRef: React.RefObject<StreamFunctions | null>;
  updateTaskRunState: (taskId: string, updater: (current: TaskRunState) => TaskRunState) => void;
  setError: (msg: string) => void;
}) {
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatProfileId, setChatProfileId] = useState("");

  const chatQueuedCount = useMemo(() => chatMessages.filter((m) => m.status === "queued").length, [chatMessages]);

  // Load chat messages on task change
  useEffect(() => {
    if (!selectedTaskId) { setChatMessages([]); return; }
    api<{ messages: ChatMessage[] }>(`/api/tasks/${encodeURIComponent(selectedTaskId)}/chat`)
      .then((payload) => setChatMessages(payload.messages))
      .catch(() => {});
  }, [selectedTaskId]);

  const sendChatMessage = useCallback(async (content: string) => {
    if (!selectedTaskId) return;
    try {
      const res = await api<{ chatMessage: ChatMessage; run: ActiveRun | null }>(
        `/api/tasks/${encodeURIComponent(selectedTaskId)}/chat`,
        { method: "POST", body: JSON.stringify({ content, profileId: chatProfileId || undefined }) },
      );
      setChatMessages((prev) => [...prev, res.chatMessage]);
      if (res.run) {
        updateTaskRunState(selectedTaskId, (prev) => ({
          ...prev,
          activeRun: res.run!,
          runLogs: [],
          runFinished: false,
        }));
        streamRef.current?.attachRunLogStream(res.run.id, selectedTaskId, selectedRepoId);
      }
    } catch (e) { setError((e as Error).message); }
  }, [selectedTaskId, selectedRepoId, chatProfileId, updateTaskRunState, streamRef, setError]);

  const cancelQueuedChat = useCallback(async () => {
    if (!selectedTaskId) return;
    try {
      await api(`/api/tasks/${encodeURIComponent(selectedTaskId)}/chat/queued`, { method: "DELETE" });
      setChatMessages((prev) => prev.filter((m) => m.status !== "queued"));
    } catch (e) { setError((e as Error).message); }
  }, [selectedTaskId, setError]);

  return {
    chatMessages, setChatMessages,
    chatProfileId, setChatProfileId,
    chatQueuedCount,
    sendChatMessage, cancelQueuedChat,
  };
}
