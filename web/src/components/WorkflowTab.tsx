import { type FC, useState } from 'react';
import { useWorkflow } from '../hooks/useWorkflow';
import { WorkflowList } from './WorkflowList';
import { WorkflowCanvas } from './WorkflowCanvas';

export const WorkflowTab: FC<{ repoId: string | null }> = ({ repoId }) => {
  const { workflows, selected, selectedId, setSelectedId, refreshList, saveGraph, run, liveStatus } = useWorkflow(repoId);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);

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
              <span className="px-2 py-1 text-sm text-text-secondary">{selected.name}</span>
              {selectedNodeId && (
                <span className="ml-auto text-xs text-text-muted">node: {selectedNodeId}</span>
              )}
              {selectedEdgeId && (
                <span className="ml-auto text-xs text-text-muted">edge: {selectedEdgeId}</span>
              )}
            </div>
            <div className="flex-1 overflow-hidden">
              <WorkflowCanvas
                graph={selected.graph}
                liveStatus={liveStatus}
                onGraphChange={(next) => void saveGraph(next)}
                onSelectNode={setSelectedNodeId}
                onSelectEdge={setSelectedEdgeId}
              />
            </div>
          </>
        ) : (
          <div className="p-6 text-text-muted text-sm">Select or create a workflow.</div>
        )}
      </main>
    </div>
  );
};
