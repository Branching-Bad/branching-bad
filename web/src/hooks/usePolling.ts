import { useEffect } from "react";

export function usePolling(callback: () => void, intervalMs: number, enabled: boolean) {
  useEffect(() => {
    if (!enabled) return;
    const interval = window.setInterval(callback, intervalMs);
    return () => window.clearInterval(interval);
  }, [callback, intervalMs, enabled]);
}
