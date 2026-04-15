import { type FC, useState, useEffect } from 'react';
import { useWorkflow } from '../hooks/useWorkflow';
import { workflowApi } from '../api/workflow';
import { WorkflowList } from './WorkflowList';
import { WorkflowCanvas } from './WorkflowCanvas';
import { WorkflowNodeEditor } from './WorkflowNodeEditor';
import { WorkflowEdgeEditor } from './WorkflowEdgeEditor';
import { WorkflowRunHistory } from './WorkflowRunHistory';
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

const KIND_LABEL: Record<'script' | 'agent' | 'merge' | 'mcp', string> = {
  script: 'Script',
  agent: 'Agent',
  merge: 'Merge',
  mcp: 'MCP',
};

const KIND_GLYPH: Record<'script' | 'agent' | 'merge' | 'mcp', string> = {
  script: '‹›',
  agent: '◆',
  merge: '⑂',
  mcp: '⚙',
};

export const WorkflowTab: FC<Props> = ({ repoId, agentProfiles }) => {
  const {
    workflows, selected, selectedId, setSelectedId,
    refreshList, refreshSelected, saveGraph, run, runs, retryNode, liveStatus,
  } = useWorkflow(repoId);

  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const [cronDraft, setCronDraft] = useState('');
  const [historyOpen, setHistoryOpen] = useState(false);
  const [running, setRunning] = useState(false);

  useEffect(() => {
    setCronDraft(selected?.cron ?? '');
  }, [selected?.id, selected?.cron]);

  // Clear selection when switching workflows
  useEffect(() => {
    setSelectedNodeId(null);
    setSelectedEdgeId(null);
  }, [selectedId]);

  const commitCron = async () => {
    if (!selected) return;
    const next = cronDraft.trim() || null;
    if (next === (selected.cron ?? null)) return;
    await workflowApi.update(selected.id, { cron: next });
    await refreshSelected();
  };

  const toggleCron = async () => {
    if (!selected) return;
    await workflowApi.toggleCron(selected.id);
    await refreshSelected();
  };

  const selectedNode = selected?.graph.nodes.find((n) => n.id === selectedNodeId) ?? null;
  const selectedEdge = selected?.graph.edges.find((e) => e.id === selectedEdgeId) ?? null;

  const edgesOnSameTarget = selectedEdge
    ? selected?.graph.edges.filter((e) => e.to === selectedEdge.to) ?? []
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

  const addNode = (kind: 'script' | 'agent' | 'merge' | 'mcp') => {
    if (!selected) return;
    const id = crypto.randomUUID();
    const offset = selected.graph.nodes.length * 24;
    const position = { x: 120 + offset, y: 100 + offset };
    const baseCommon = { id, label: KIND_LABEL[kind], position, onFail: 'halt-subtree' as const };
    const newNode: GraphNode =
      kind === 'script'
        ? { ...baseCommon, kind, lang: 'python', source: 'inline', code: '' }
        : kind === 'agent'
        ? { ...baseCommon, kind, agentProfileId: '', promptTemplate: '' }
        : kind === 'mcp'
        ? { ...baseCommon, kind, agentProfileId: '', mcpServerId: '', promptTemplate: '' }
        : { ...baseCommon, kind };
    void saveGraph({ ...selected.graph, nodes: [...selected.graph.nodes, newNode] });
    setSelectedNodeId(id);
    setSelectedEdgeId(null);
  };

  const triggerRun = async () => {
    if (!selected || running) return;
    setRunning(true);
    try {
      await run();
      setHistoryOpen(true);
    } finally {
      setTimeout(() => setRunning(false), 400);
    }
  };

  // Keyboard — delete selection
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
    return (
      <div className="flex h-full items-center justify-center text-sm text-text-muted">
        Select a repo to view workflows.
      </div>
    );
  }

  return (
    <div className="flex h-full gap-3 bg-surface-0 p-3">
      <WorkflowList
        repoId={repoId}
        workflows={workflows}
        selectedId={selectedId}
        onSelect={setSelectedId}
        onCreated={() => void refreshList()}
      />
      <section className="relative flex min-w-0 flex-1 flex-col overflow-hidden rounded-[var(--radius-xl)] border border-border-default bg-surface-100 shadow-[var(--shadow-md)]">
        {selected ? (
          <>
            {/* ── Workflow header ─────────────────────────────── */}
            <header className="flex items-center gap-3 border-b border-border-default bg-surface-100/70 px-5 py-3 backdrop-blur-md">
              <div className="flex min-w-0 flex-1 items-center gap-2">
                <h2 className="truncate text-[15px] font-semibold text-text-primary">
                  {selected.name}
                </h2>
                <span className="rounded-full bg-surface-200 px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.08em] text-text-muted">
                  {selected.graph.nodes.length} nodes · {selected.graph.edges.length} edges
                </span>
              </div>

              {/* Schedule cluster */}
              <div className="flex items-center gap-2">
                <div className="flex items-center gap-1.5 rounded-full border border-border-default bg-surface-200 px-2.5 py-1">
                  <svg className="h-3.5 w-3.5 text-text-muted" viewBox="0 0 16 16" fill="none">
                    <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.4" />
                    <path d="M8 4v4l2.5 1.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
                  </svg>
                  <input
                    className="w-32 bg-transparent text-[12px] font-mono text-text-primary placeholder:text-text-muted focus:outline-none"
                    placeholder="*/5 * * * *"
                    value={cronDraft}
                    onChange={(e) => setCronDraft(e.target.value)}
                    onBlur={() => void commitCron()}
                    onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
                  />
                </div>

                {/* SF-style toggle switch */}
                <button
                  type="button"
                  onClick={() => void toggleCron()}
                  disabled={!selected.cron}
                  aria-label="Toggle cron schedule"
                  className={`relative h-[22px] w-[38px] shrink-0 rounded-full transition-colors ${
                    selected.cron_enabled ? 'bg-status-success' : 'bg-surface-300'
                  } disabled:opacity-40`}
                >
                  <span
                    className={`absolute top-[2px] h-[18px] w-[18px] rounded-full bg-white shadow-[0_2px_4px_rgba(0,0,0,0.3)] transition-all ${
                      selected.cron_enabled ? 'left-[18px]' : 'left-[2px]'
                    }`}
                  />
                </button>
              </div>

              <div className="mx-1 h-5 w-px bg-border-default" />

              {/* Run */}
              <button
                onClick={() => void triggerRun()}
                disabled={running}
                className="flex items-center gap-1.5 rounded-full bg-brand px-3.5 py-1.5 text-[12px] font-semibold text-white shadow-[0_1px_2px_rgba(0,0,0,0.2),0_0_0_1px_var(--color-brand-dark)_inset] transition hover:bg-brand-dark disabled:opacity-50"
              >
                <svg className="h-3 w-3" viewBox="0 0 12 12" fill="currentColor">
                  <path d="M3 2.2a.5.5 0 0 1 .78-.42l5.6 3.8a.5.5 0 0 1 0 .84l-5.6 3.8A.5.5 0 0 1 3 9.8V2.2Z" />
                </svg>
                Run
              </button>
            </header>

            {/* ── Sub-toolbar: add-node segmented control ────── */}
            <div className="flex items-center gap-2 border-b border-border-default bg-surface-0 px-5 py-2">
              <span className="text-[11px] font-medium uppercase tracking-[0.08em] text-text-muted">
                Add node
              </span>
              <div className="flex items-center gap-0.5 rounded-[var(--radius-md)] border border-border-default bg-surface-200 p-0.5">
                {(['script', 'agent', 'merge', 'mcp'] as const).map((k) => (
                  <button
                    key={k}
                    onClick={() => addNode(k)}
                    className="flex items-center gap-1.5 rounded-[6px] px-2.5 py-1 text-[12px] font-medium text-text-secondary transition hover:bg-surface-300 hover:text-text-primary"
                  >
                    <span className="text-[13px] text-brand">{KIND_GLYPH[k]}</span>
                    {KIND_LABEL[k]}
                  </button>
                ))}
              </div>

              <div className="ml-auto flex items-center gap-3 text-[11px] text-text-muted">
                <span className="flex items-center gap-1.5">
                  <svg className="h-3 w-3" viewBox="0 0 12 12"><path d="M1 6h10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>
                  required
                </span>
                <span className="flex items-center gap-1.5">
                  <svg className="h-3 w-3" viewBox="0 0 12 12"><path d="M1 6h2M5 6h2M9 6h2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>
                  optional
                </span>
                <span className="hidden md:inline text-text-muted/70">
                  delete: ⌫ · pan: drag canvas · zoom: scroll
                </span>
              </div>
            </div>

            {/* ── Canvas + right editor ───────────────────────── */}
            <div className="flex min-h-0 flex-1 overflow-hidden">
              <div className="relative flex-1">
                <WorkflowCanvas
                  graph={selected.graph}
                  liveStatus={liveStatus}
                  selectedNodeId={selectedNodeId}
                  selectedEdgeId={selectedEdgeId}
                  onGraphChange={(next) => void saveGraph(next)}
                  onSelectNode={handleSelectNode}
                  onSelectEdge={handleSelectEdge}
                />
              </div>
              {selectedNode && !selectedEdge && (
                <WorkflowNodeEditor
                  node={selectedNode}
                  graph={selected.graph}
                  agentProfiles={agentProfiles}
                  onChange={handleNodeChange}
                  onGraphChange={(next) => void saveGraph(next)}
                  onDelete={handleNodeDelete}
                  onClose={() => setSelectedNodeId(null)}
                />
              )}
              {selectedEdge && !selectedNode && (
                <WorkflowEdgeEditor
                  edge={selectedEdge}
                  edgesOnSameTarget={edgesOnSameTarget}
                  onChange={handleEdgeChange}
                  onDelete={handleEdgeDelete}
                  onClose={() => setSelectedEdgeId(null)}
                />
              )}
            </div>

            {/* ── Run history drawer ──────────────────────────── */}
            <WorkflowRunHistory
              runs={runs}
              open={historyOpen}
              onToggle={() => setHistoryOpen((v) => !v)}
              onRetryNode={async (runId, nodeId) => {
                await retryNode(runId, nodeId);
                await refreshSelected();
              }}
            />
          </>
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
            <div className="text-sm text-text-secondary">
              Select a workflow from the list or create a new one
            </div>
            <div className="text-xs text-text-muted">
              DAG-based script pipelines — Python, TypeScript, and agent nodes
            </div>
          </div>
        )}
      </section>
    </div>
  );
};
