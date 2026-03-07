import { useEffect } from "react";

interface KeyboardActions {
  onNewSession: () => void;
  onSend: () => void;
  onEscape: () => void;
}

export function useKeyboard({ onNewSession, onSend, onEscape }: KeyboardActions) {
  useEffect(() => {
    function handler(e: KeyboardEvent) {
      const meta = e.metaKey || e.ctrlKey;

      // Cmd+K: New session
      if (meta && e.key === "k") {
        e.preventDefault();
        onNewSession();
        return;
      }

      // Cmd+Enter: Send message
      if (meta && e.key === "Enter") {
        e.preventDefault();
        onSend();
        return;
      }

      // Escape: Clear / deselect
      if (e.key === "Escape") {
        onEscape();
      }
    }

    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onNewSession, onSend, onEscape]);
}
