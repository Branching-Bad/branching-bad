import { useCallback, useEffect, useState } from 'react';
import { mcpApi } from './api';
import type { McpCatalog, McpServer, McpTestResult, McpInstallPayload } from './types';

export function useMcpServers() {
  const [catalog, setCatalog] = useState<McpCatalog | null>(null);
  const [servers, setServers] = useState<McpServer[]>([]);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    const [cat, list] = await Promise.all([mcpApi.catalog(), mcpApi.list()]);
    setCatalog(cat);
    setServers(list);
  }, []);

  useEffect(() => {
    setLoading(true);
    refresh().finally(() => setLoading(false));
  }, [refresh]);

  const install = useCallback(async (payload: McpInstallPayload) => {
    const s = await mcpApi.create(payload);
    await refresh();
    return s;
  }, [refresh]);

  const update = useCallback(async (id: string, patch: Partial<McpInstallPayload> & { enabled?: boolean }) => {
    const s = await mcpApi.update(id, patch);
    await refresh();
    return s;
  }, [refresh]);

  const remove = useCallback(async (id: string) => {
    await mcpApi.delete(id);
    await refresh();
  }, [refresh]);

  const test = useCallback((id: string): Promise<McpTestResult> => mcpApi.test(id), []);

  return { catalog, servers, loading, refresh, install, update, remove, test };
}
