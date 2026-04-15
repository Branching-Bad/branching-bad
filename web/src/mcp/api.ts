import type { McpCatalog, McpServer, McpTestResult, McpInstallPayload } from './types';

const base = '/api/mcp';

async function j<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  if (!res.ok) throw new Error(await res.text());
  return res.status === 204 ? (undefined as T) : await res.json();
}

export const mcpApi = {
  catalog: () => j<McpCatalog>(`${base}/catalog`),
  list:    () => j<McpServer[]>(`${base}/servers`),
  get:     (id: string) => j<McpServer>(`${base}/servers/${id}`),
  create:  (body: McpInstallPayload) =>
    j<McpServer>(`${base}/servers`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
  update:  (id: string, patch: Partial<McpInstallPayload> & { enabled?: boolean }) =>
    j<McpServer>(`${base}/servers/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch) }),
  delete:  (id: string) => j<void>(`${base}/servers/${id}`, { method: 'DELETE' }),
  test:    (id: string) => j<McpTestResult>(`${base}/servers/${id}/test`, { method: 'POST' }),
  listForProfile: (profileId: string) => j<McpServer[]>(`/api/agent-profiles/${profileId}/mcp`),
  setForProfile:  (profileId: string, mcpServerIds: string[]) =>
    j<McpServer[]>(`/api/agent-profiles/${profileId}/mcp`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mcpServerIds }) }),
};
