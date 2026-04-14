import { type FC, useState, useEffect } from 'react';
import { useWorkflow } from '../hooks/useWorkflow';
import { WorkflowList } from './WorkflowList';
import { WorkflowCanvas } from './WorkflowCanvas';
import { WorkflowNodeEditor } from './WorkflowNodeEditor';
import { WorkflowEdgeEditor } from './WorkflowEdgeEditor';
import type { Edge, Graph, GraphNode } from '../types/workflow';

const normalizeInputOrder = (g: Graph, toId: string): Graph => {
  const onTarget = g.edges.filter((e) => e.to === toId).sort((a, b) => a.inputOrder - b.inputOrder);
  const others = g.edges.filter((e) => e.to !== toId);
  const remapped = onTarget.map((e, i) => ({ ...e, inputOrder: i + 1 }));
  return { ...g, edges: [...others, ...remapped] };
};

interface Props {
  repoId: string | null;
  agentProfiles: Array<{ id: string; name: string }>;
}

export const WorkflowTab: FC<Props> = ({ repoId, agentProfiles }) => {
  const { workflows, selected, selectedId, setSelectedId, refreshList, saveGraph, run, liveStatus } = useWorkflow(repoId);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);

  const selectedNode = selected?.graph.nodes.find((n) => n.id === selectedNodeId) ?? null;
  const selectedEdge = selected?.graph.edges.find((e) => e.id === selectedEdgeId) ?? null;

  const edgesOnSameTarget = selectedEdge
    ? (selected?.graph.edges.filter((e) => e.to === selectedEdge.to) ?? [])
    : [];

  const handleEdgeChange = (next: Edge) => {
    if (!selected || !selectedEdgeId) return;
    const g = selected.graph;
    const others = g.edges.filter((e) => e.id !== selectedEdgeId);
    const onTargetCount = others.filter((e) => e.to === next.to).length + 1;
    const clampedOrder = Math.max(1, Math.min(onTargetCount, Math.floor(next.inputOrder)));
    const newEdge: Edge = { ...next, inputOrder: clampedOrder };
    const withReplaced: Graph = { ...g, edges: [...others, newEdge] };
    void saveGraph(normalizeInputOrder(withReplaced, next.to));
  };

  const handleEdgeDelete = () => {
    if (!selected || !selectedEdgeId) return;
    const g = selected.graph;
    const doomed = g.edges.find((e) => e.id === selectedEdgeId);
    if (!doomed) return;
    const without: Graph = { ...g, edges: g.edges.filter((e) => e.id !== selectedEdgeId) };
    void saveGraph(normalizeInputOrder(without, doomed.to));
    setSelectedEdgeId(null);
  };

  const handleSelectNode = (id: string | null) => {
    setSelectedNodeId(id);
    if (id) setSelectedEdgeId(null);
  };

  const handleSelectEdge = (id: string | null) => {
    setSelectedEdgeId(id);
    if (id) setSelectedNodeId(null);
  };

  const handleNodeChange = (next: GraphNode) => {
    if (!selected || !selectedNodeId) return;
    void saveGraph({
      ...selected.graph,
      nodes: selected.graph.nodes.map((n) => (n.id === selectedNodeId ? next : n)),
    });
  };

  const handleNodeDelete = () => {
    if (!selected || !selectedNodeId) return;
    void saveGraph({
      ...selected.graph,
      nodes: selected.graph.nodes.filter((n) => n.id !== selectedNodeId),
      edges: selected.graph.edges.filter((e) => e.from !== selectedNodeId && e.to !== selectedNodeId),
    });
    setSelectedNodeId(null);
  };

  const addNode = (kind: 'script' | 'agent' | 'merge') => {
    if (!selected) return;
    const id = crypto.randomUUID();
    const offset = selected.graph.nodes.length * 20;
    const position = { x: 80 + offset, y: 80 + offset };
    const baseCommon = { id, label: kind, position, onFail: 'halt-subtree' as const };
    const newNode: GraphNode =
      kind === 'script'
        ? { ...baseCommon, kind, lang: 'python', source: 'inline', code: '' }
        : kind === 'agent'
        ? { ...baseCommon, kind, agentProfileId: '', promptTemplate: '' }
        : { ...baseCommon, kind };
    void saveGraph({ ...selected.graph, nodes: [...selected.graph.nodes, newNode] });
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Delete' && e.key !== 'Backspace') return;
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (!selected) return;
      if (selectedNodeId) {
        void saveGraph({
          ...selected.graph,
          nodes: selected.graph.nodes.filter((n) => n.id !== selectedNodeId),
          edges: selected.graph.edges.filter((e) => e.from !== selectedNodeId && e.to !== selectedNodeId),
        });
        setSelectedNodeId(null);
      } else if (selectedEdgeId) {
        const doomed = selected.graph.edges.find((e) => e.id === selectedEdgeId);
        if (doomed) {
          const without: Graph = { ...selected.graph, edges: selected.graph.edges.filter((e) => e.id !== selectedEdgeId) };
          void saveGraph(normalizeInputOrder(without, doomed.to));
        }
        setSelectedEdgeId(null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selected, selectedNodeId, selectedEdgeId, saveGraph]);

  if (!repoId) {
    return <div className="p-6 text-sm text-text-muted">Select a repo to view workflows.</div>;
  }

  return (
    <div className="flex h-full">
      <WorkflowList
        repoId={repoId}
        workflows={workflows}
        selectedId={selectedId}
        onSelect={setSelectedId}
        onCreated={() => void refreshList()}
      />
      <main className="flex-1 flex flex-col">
        {selected ? (
          <>
            <div className="p-2 border-b border-border-default flex gap-2 items-center">
              <button
                className="bg-brand hover:bg-brand-dark text-white px-3 py-1 rounded text-sm transition-colors"
                onClick={() => void run()}
              >
                Run
              </button>
              <button
                className="bg-[#1e293b] hover:bg-[#334155] text-text-primary px-3 py-1 rounded text-sm transition-colors border border-border-default"
                onClick={() => addNode('script')}
              >
                + Script
              </button>
              <button
                className="bg-[#1e293b] hover:bg-[#334155] text-text-primary px-3 py-1 rounded text-sm transition-colors border border-border-default"
                onClick={() => addNode('agent')}
              >
                + Agent
              </button>
              <button
                className="bg-[#1e293b] hover:bg-[#334155] text-text-primary px-3 py-1 rounded text-sm transition-colors border border-border-default"
                onClick={() => addNode('merge')}
              >
                + Merge
              </button>
              <span className="px-2 py-1 text-sm text-text-secondary">{selected.name}</span>
              {selectedNodeId && (
                <span className="ml-auto text-xs text-text-muted">node: {selectedNodeId}</span>
              )}
              {selectedEdgeId && (
                <span className="ml-auto text-xs text-text-muted">edge: {selectedEdgeId}</span>
              )}
            </div>
            <div className="flex-1 overflow-hidden flex">
              <WorkflowCanvas
                graph={selected.graph}
                liveStatus={liveStatus}
                onGraphChange={(next) => void saveGraph(next)}
                onSelectNode={handleSelectNode}
                onSelectEdge={handleSelectEdge}
              />
              {selectedNode && !selectedEdge && (
                <WorkflowNodeEditor
                  node={selectedNode}
                  agentProfiles={agentProfiles}
                  onChange={handleNodeChange}
                  onDelete={handleNodeDelete}
                />
              )}
              {selectedEdge && !selectedNode && (
                <WorkflowEdgeEditor
                  edge={selectedEdge}
                  edgesOnSameTarget={edgesOnSameTarget}
                  onChange={handleEdgeChange}
                  onDelete={handleEdgeDelete}
                />
              )}
            </div>
          </>
        ) : (
          <div className="p-6 text-text-muted text-sm">Select or create a workflow.</div>
        )}
      </main>
    </div>
  );
};
