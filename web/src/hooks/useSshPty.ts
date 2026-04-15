import { useCallback } from "react";
import { api } from "../api";

export function useSshPty() {
  const openPty = useCallback(async (sessionId: string, cols: number, rows: number): Promise<string> => {
    const res = await api<{ ptyId: string }>(`/api/ssh/sessions/${encodeURIComponent(sessionId)}/pty`, {
      method: 'POST', body: JSON.stringify({ cols, rows }),
    });
    return res.ptyId;
  }, []);

  const closePty = useCallback(async (ptyId: string) => {
    await api(`/api/ssh/ptys/${encodeURIComponent(ptyId)}`, { method: 'DELETE' });
  }, []);

  return { openPty, closePty };
}

export type UseSshPty = ReturnType<typeof useSshPty>;
