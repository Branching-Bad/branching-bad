import { useCallback, useEffect, useRef, useState } from 'react';
import { workflowApi } from '../api/workflow';
import type { Workflow, WorkflowRun, NodeAttempt, Graph, AttemptStatus } from '../types/workflow';

export interface UseWorkflowReturn {
  workflows: Workflow[];
  selected: Workflow | null;
  selectedId: string | null;
  setSelectedId: (id: string | null) => void;
  runs: WorkflowRun[];
  activeRun: { run: WorkflowRun; attempts: NodeAttempt[] } | null;
  liveStatus: Record<string, AttemptStatus>;
  refreshList: () => Promise<void>;
  refreshSelected: () => Promise<void>;
  saveGraph: (graph: Graph) => Promise<void>;
  run: () => Promise<string | null>;
  retryNode: (runId: string, nodeId: string) => Promise<void>;
}

export function useWorkflow(repoId: string | null): UseWorkflowReturn {
  const [workflows, setWorkflows] = useState<Workflow[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selected, setSelected] = useState<Workflow | null>(null);
  const [runs, setRuns] = useState<WorkflowRun[]>([]);
  const [activeRun, setActiveRun] = useState<{ run: WorkflowRun; attempts: NodeAttempt[] } | null>(null);
  const [liveStatus, setLiveStatus] = useState<Record<string, AttemptStatus>>({});
  const wsRef = useRef<WebSocket | null>(null);

  const refreshList = useCallback(async () => {
    if (!repoId) { setWorkflows([]); return; }
    setWorkflows(await workflowApi.list(repoId));
  }, [repoId]);

  const refreshSelected = useCallback(async () => {
    if (!selectedId) { setSelected(null); setRuns([]); return; }
    const [wf, rs] = await Promise.all([workflowApi.get(selectedId), workflowApi.listRuns(selectedId)]);
    setSelected(wf);
    setRuns(rs);
  }, [selectedId]);

  useEffect(() => { void refreshList(); }, [refreshList]);
  useEffect(() => { void refreshSelected(); }, [refreshSelected]);

  const subscribeRun = useCallback((runId: string) => {
    wsRef.current?.close();
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const ws = new WebSocket(`${proto}://${location.host}/api/ws/global`);
    ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data as string) as Record<string, unknown>;
        if (typeof msg.topic !== 'string' || !msg.topic.startsWith(`workflow:run:${runId}`)) return;
        setLiveStatus((prev) => {
          if (msg.type === 'node.state' && msg.nodeId && msg.status) {
            return { ...prev, [msg.nodeId as string]: msg.status as AttemptStatus };
          }
          return prev;
        });
        setActiveRun((prev) => {
          if (!prev) return prev;
          if (msg.type === 'node.state') {
            return {
              ...prev,
              attempts: prev.attempts.map((a) =>
                a.id === msg.attemptId
                  ? {
                      ...a,
                      status: msg.status as AttemptStatus,
                      ended_at: (msg.endedAt as string | null | undefined) ?? a.ended_at,
                      exit_code: (msg.exitCode as number | null | undefined) ?? a.exit_code,
                    }
                  : a,
              ),
            };
          }
          if (msg.type === 'run.state') {
            return {
              ...prev,
              run: {
                ...prev.run,
                status: msg.status as WorkflowRun['status'],
                ended_at: (msg.endedAt as string | null | undefined) ?? prev.run.ended_at,
              },
            };
          }
          return prev;
        });
      } catch { /* ignore malformed */ }
    };
    wsRef.current = ws;
  }, []);

  useEffect(() => () => { wsRef.current?.close(); }, []);

  const saveGraph = useCallback(async (graph: Graph) => {
    if (!selectedId) return;
    const wf = await workflowApi.update(selectedId, { graph });
    setSelected(wf);
  }, [selectedId]);

  const run = useCallback(async () => {
    if (!selectedId) return null;
    const { runId } = await workflowApi.run(selectedId);
    const data = await workflowApi.getRun(runId);
    setActiveRun(data);
    const initial: Record<string, AttemptStatus> = {};
    for (const a of data.attempts) initial[a.node_id] = a.status;
    setLiveStatus(initial);
    subscribeRun(runId);
    return runId;
  }, [selectedId, subscribeRun]);

  const retryNode = useCallback(async (runId: string, nodeId: string) => {
    await workflowApi.retryNode(runId, nodeId);
    const data = await workflowApi.getRun(runId);
    setActiveRun(data);
  }, []);

  return {
    workflows, selected, selectedId, setSelectedId,
    runs, activeRun, liveStatus,
    refreshList, refreshSelected, saveGraph, run, retryNode,
  };
}
