import { type FC } from 'react';
import type { Edge } from '../types/workflow';

interface Props {
  edge: Edge;
  edgesOnSameTarget: Edge[];
  onChange: (next: Edge) => void;
  onDelete: () => void;
}

export const WorkflowEdgeEditor: FC<Props> = ({ edge, edgesOnSameTarget, onChange, onDelete }) => (
  <aside className="w-96 border-l border-border-default bg-surface-100 p-3 flex flex-col gap-3">
    <label className="text-xs text-text-secondary flex items-center gap-2">
      <input
        type="checkbox"
        checked={edge.required}
        onChange={(e) => onChange({ ...edge, required: e.target.checked })}
      />
      Required (circuit breaker) — failed source blocks this edge's target subtree
    </label>

    <label className="text-xs text-text-secondary flex flex-col gap-1">
      Input order on target (1..{edgesOnSameTarget.length})
      <input
        type="number"
        min={1}
        max={edgesOnSameTarget.length}
        value={edge.inputOrder}
        onChange={(e) => onChange({ ...edge, inputOrder: Number(e.target.value) })}
        className="w-full bg-surface-200 px-2 py-1 rounded text-sm text-text-primary"
      />
    </label>

    <div className="text-xs text-text-muted">
      Input order controls stdin concatenation on the target node when it has multiple parents.
      Lower numbers are prepended first.
    </div>

    <button
      className="mt-auto bg-red-700 hover:bg-red-600 text-white px-2 py-1 rounded text-sm"
      onClick={onDelete}
    >
      Delete edge
    </button>
  </aside>
);
