import { useCallback, useEffect, useState } from "react";
import { api } from "../api";

export function useSshMigration() {
  const [available, setAvailable] = useState(false);
  const [sourcePath, setSourcePath] = useState<string | null>(null);

  const check = useCallback(async () => {
    try {
      const res = await api<{ available: boolean; path: string | null }>('/api/ssh/migration/sshmaster');
      setAvailable(res.available);
      setSourcePath(res.path);
    } catch { /* silent */ }
  }, []);

  useEffect(() => { void check(); }, [check]);

  const runImport = useCallback(async (): Promise<{ created: number; updated: number; skipped: number }> => {
    const res = await api<{ created: number; updated: number; skipped: number }>('/api/ssh/migration/sshmaster', {
      method: 'POST',
    });
    setAvailable(false);
    return res;
  }, []);

  const dismiss = useCallback(async () => {
    await api('/api/ssh/migration/sshmaster/dismiss', { method: 'POST' });
    setAvailable(false);
  }, []);

  return { available, sourcePath, runImport, dismiss };
}

export type UseSshMigration = ReturnType<typeof useSshMigration>;
