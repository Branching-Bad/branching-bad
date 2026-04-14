import type { Workflow, WorkflowRun, NodeAttempt, Graph } from '../types/workflow';

const base = '/api/workflow';

async function jsonFetch<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  if (!res.ok) throw new Error(await res.text());
  return res.status === 204 ? (undefined as T) : await res.json() as T;
}

export const workflowApi = {
  list: (repoId: string) =>
    jsonFetch<Workflow[]>(`${base}?repoId=${encodeURIComponent(repoId)}`),
  create: (repoId: string, name: string, graph: Graph) =>
    jsonFetch<Workflow>(base, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ repoId, name, graph }),
    }),
  get: (id: string) => jsonFetch<Workflow>(`${base}/${id}`),
  update: (id: string, patch: { name?: string; graph?: Graph; cron?: string | null; cron_enabled?: boolean }) =>
    jsonFetch<Workflow>(`${base}/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    }),
  delete: (id: string) => jsonFetch<void>(`${base}/${id}`, { method: 'DELETE' }),
  run: (id: string) => jsonFetch<{ runId: string }>(`${base}/${id}/run`, { method: 'POST' }),
  listRuns: (id: string, limit = 50) =>
    jsonFetch<WorkflowRun[]>(`${base}/${id}/runs?limit=${limit}`),
  getRun: (runId: string) => jsonFetch<{ run: WorkflowRun; attempts: NodeAttempt[] }>(`${base}/runs/${runId}`),
  retryNode: (runId: string, nodeId: string) =>
    jsonFetch<{ attemptId: string }>(`${base}/runs/${runId}/nodes/${nodeId}/retry`, { method: 'POST' }),
  toggleCron: (id: string) => jsonFetch<Workflow>(`${base}/${id}/cron/toggle`, { method: 'POST' }),
  attemptStdoutUrl: (runId: string, attemptId: string) => `${base}/runs/${runId}/attempts/${attemptId}/stdout`,
  attemptStderrUrl: (runId: string, attemptId: string) => `${base}/runs/${runId}/attempts/${attemptId}/stderr`,
};
