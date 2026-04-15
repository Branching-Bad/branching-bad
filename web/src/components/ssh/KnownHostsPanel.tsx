import { useCallback, useEffect, useState } from "react";
import { api } from "../../api";
import type { SshHostKey } from "../../types";
import { IconX } from "../icons";

export function KnownHostsPanel() {
  const [hosts, setHosts] = useState<SshHostKey[]>([]);

  const refresh = useCallback(async () => {
    const res = await api<{ hosts: SshHostKey[] }>('/api/ssh/known-hosts');
    setHosts(res.hosts ?? []);
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const remove = async (host: string, port: number) => {
    await api(`/api/ssh/known-hosts/${encodeURIComponent(host)}/${port}`, { method: 'DELETE' });
    await refresh();
  };

  return (
    <div className="space-y-2">
      {hosts.length === 0 && <p className="text-[11px] italic text-text-muted">No known hosts yet.</p>}
      {hosts.map((h) => (
        <div key={`${h.host}:${h.port}`} className="group flex items-center gap-2 rounded-[var(--radius-md)] border border-border-default bg-surface-200 px-3 py-2">
          <div className="min-w-0 flex-1">
            <p className="truncate text-[12px] text-text-primary">{h.host}:{h.port}</p>
            <p className="truncate font-mono text-[10px] text-text-muted">{h.fingerprint}</p>
          </div>
          <button onClick={() => void remove(h.host, h.port)} className="text-text-muted opacity-0 hover:text-status-danger group-hover:opacity-100" title="Delete">
            <IconX className="h-3 w-3" />
          </button>
        </div>
      ))}
    </div>
  );
}
