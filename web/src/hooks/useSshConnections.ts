import { useCallback, useEffect, useState } from "react";
import { api } from "../api";
import type { SshConnection, SshGroup, SshForward } from "../types";

export interface CreateConnectionInput {
  alias: string;
  groupId: string | null;
  host: string;
  port: number;
  username: string;
  authType: 'password' | 'key';
  keyPath: string | null;
  password?: string;
  passphrase?: string;
  jumpHostId: string | null;
  forwards: Omit<SshForward, 'id' | 'connectionId' | 'createdAt'>[];
}

export function useSshConnections(opts: { setError: (msg: string) => void }) {
  const [connections, setConnections] = useState<SshConnection[]>([]);
  const [groups, setGroups] = useState<SshGroup[]>([]);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [c, g] = await Promise.all([
        api<{ connections: SshConnection[] }>('/api/ssh/connections'),
        api<{ groups: SshGroup[] }>('/api/ssh/groups'),
      ]);
      setConnections(c.connections ?? []);
      setGroups(g.groups ?? []);
    } catch (e) {
      opts.setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [opts]);

  useEffect(() => { void refresh(); }, [refresh]);

  const create = useCallback(async (input: CreateConnectionInput): Promise<SshConnection> => {
    const res = await api<{ connection: SshConnection }>('/api/ssh/connections', {
      method: 'POST', body: JSON.stringify(input),
    });
    await refresh();
    return res.connection;
  }, [refresh]);

  const update = useCallback(async (id: string, patch: Partial<CreateConnectionInput>): Promise<SshConnection> => {
    const res = await api<{ connection: SshConnection }>(`/api/ssh/connections/${encodeURIComponent(id)}`, {
      method: 'PATCH', body: JSON.stringify(patch),
    });
    await refresh();
    return res.connection;
  }, [refresh]);

  const remove = useCallback(async (id: string) => {
    await api(`/api/ssh/connections/${encodeURIComponent(id)}`, { method: 'DELETE' });
    await refresh();
  }, [refresh]);

  const createGroup = useCallback(async (name: string): Promise<SshGroup> => {
    const res = await api<{ group: SshGroup }>('/api/ssh/groups', {
      method: 'POST', body: JSON.stringify({ name }),
    });
    await refresh();
    return res.group;
  }, [refresh]);

  const renameGroup = useCallback(async (id: string, name: string) => {
    await api(`/api/ssh/groups/${encodeURIComponent(id)}`, {
      method: 'PATCH', body: JSON.stringify({ name }),
    });
    await refresh();
  }, [refresh]);

  const deleteGroup = useCallback(async (id: string) => {
    await api(`/api/ssh/groups/${encodeURIComponent(id)}`, { method: 'DELETE' });
    await refresh();
  }, [refresh]);

  return { connections, groups, loading, refresh, create, update, remove, createGroup, renameGroup, deleteGroup };
}

export type UseSshConnections = ReturnType<typeof useSshConnections>;
