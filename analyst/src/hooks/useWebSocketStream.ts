import { useState, useEffect, useRef, useCallback, useSyncExternalStore } from "react";
import type { RunLogEntry } from "../types";

const MAX_LOG_ENTRIES = 10_000;

type StoreState = {
  logs: RunLogEntry[];
  isConnected: boolean;
  isFinished: boolean;
};

function createWsStore() {
  let state: StoreState = { logs: [], isConnected: false, isFinished: false };
  const listeners = new Set<() => void>();

  function emit() {
    for (const l of listeners) l();
  }

  return {
    getState: () => state,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    reset: () => {
      state = { logs: [], isConnected: false, isFinished: false };
      emit();
    },
    setConnected: (v: boolean) => {
      state = { ...state, isConnected: v };
      emit();
    },
    setFinished: () => {
      state = { ...state, isFinished: true };
      emit();
    },
    appendLog: (entry: RunLogEntry) => {
      const next = [...state.logs, entry];
      state = { ...state, logs: next.length > MAX_LOG_ENTRIES ? next.slice(next.length - MAX_LOG_ENTRIES) : next };
      emit();
    },
    clearLogs: () => {
      state = { ...state, logs: [] };
      emit();
    },
  };
}

export function useWebSocketStream(url: string | null) {
  const [store] = useState(createWsStore);
  const wsRef = useRef<WebSocket | null>(null);
  const retryCountRef = useRef(0);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const state = useSyncExternalStore(store.subscribe, store.getState);

  useEffect(() => {
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    if (retryTimerRef.current) {
      clearTimeout(retryTimerRef.current);
      retryTimerRef.current = null;
    }

    store.reset();
    retryCountRef.current = 0;

    if (!url) return;

    let cancelled = false;
    let finished = false;

    const connect = () => {
      if (cancelled) return;

      const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
      const wsUrl = `${protocol}//${window.location.host}${url}`;
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        if (cancelled) { ws.close(); return; }
        store.setConnected(true);
        retryCountRef.current = 0;
      };

      ws.onmessage = (event) => {
        if (cancelled) return;
        try {
          const msg = JSON.parse(event.data as string) as { type: string; data: string };
          store.appendLog({ type: msg.type, data: msg.data });
          if (msg.type === "finished") {
            finished = true;
            store.setFinished();
            ws.close();
          }
        } catch {
          // ignore malformed messages
        }
      };

      ws.onclose = () => {
        if (cancelled || finished) return;
        store.setConnected(false);
        wsRef.current = null;

        if (retryCountRef.current >= 5) return;

        const delays = [250, 500, 1000, 1500, 2000];
        const delay = delays[retryCountRef.current] ?? 2000;
        retryCountRef.current++;
        retryTimerRef.current = setTimeout(connect, delay);
      };

      ws.onerror = () => {
        // onclose will fire after this
      };
    };

    connect();

    return () => {
      cancelled = true;
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
      if (retryTimerRef.current) {
        clearTimeout(retryTimerRef.current);
        retryTimerRef.current = null;
      }
    };
  }, [url, store]);

  const clearLogs = useCallback(() => store.clearLogs(), [store]);
  const appendLog = useCallback((entry: RunLogEntry) => store.appendLog(entry), [store]);

  return { logs: state.logs, isConnected: state.isConnected, isFinished: state.isFinished, clearLogs, appendLog };
}
