import { type FC } from 'react';
import type { Edge } from '../types/workflow';

interface Props {
  edge: Edge;
  edgesOnSameTarget: Edge[];
  onChange: (next: Edge) => void;
  onDelete: () => void;
  onClose: () => void;
}

export const WorkflowEdgeEditor: FC<Props> = ({ edge, edgesOnSameTarget, onChange, onDelete, onClose }) => {
  const count = edgesOnSameTarget.length || 1;

  return (
    <aside className="m-3 flex w-[340px] shrink-0 flex-col overflow-hidden rounded-[var(--radius-xl)] border border-border-default bg-surface-100 shadow-[var(--shadow-md)]">
      <header className="flex items-center justify-between gap-2 border-b border-border-default px-4 py-3">
        <div className="flex items-center gap-2">
          <span className="rounded-full bg-brand-tint px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.1em] text-brand">
            Edge
          </span>
          <span className="text-[13px] font-medium text-text-primary">Inspector</span>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close inspector"
          className="flex h-7 w-7 items-center justify-center rounded-full text-text-muted transition hover:bg-surface-200 hover:text-text-primary"
        >
          <svg className="h-3.5 w-3.5" viewBox="0 0 14 14" fill="none">
            <path d="M3 3l8 8M11 3l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        </button>
      </header>

      <div className="flex-1 space-y-5 overflow-auto px-4 py-4">
        <section className="space-y-3">
          <h3 className="text-[10px] font-semibold uppercase tracking-[0.12em] text-text-muted">Behavior</h3>
          <div className="space-y-3 rounded-[var(--radius-lg)] border border-border-default bg-surface-0/50 p-3">
            {/* SF-style switch: Required */}
            <div className="flex items-start justify-between gap-3">
              <div className="space-y-1">
                <div className="text-[12px] font-medium text-text-primary">Required</div>
                <p className="text-[10px] leading-relaxed text-text-muted">
                  Failed source blocks this edge's target subtree.
                </p>
              </div>
              <button
                type="button"
                onClick={() => onChange({ ...edge, required: !edge.required })}
                aria-label="Toggle required"
                className={`relative mt-0.5 h-[22px] w-[38px] shrink-0 rounded-full transition-colors ${
                  edge.required ? 'bg-brand' : 'bg-surface-300'
                }`}
              >
                <span
                  className={`absolute top-[2px] h-[18px] w-[18px] rounded-full bg-white shadow-[0_2px_4px_rgba(0,0,0,0.3)] transition-all ${
                    edge.required ? 'left-[18px]' : 'left-[2px]'
                  }`}
                />
              </button>
            </div>
          </div>
        </section>

        <section className="space-y-3">
          <h3 className="text-[10px] font-semibold uppercase tracking-[0.12em] text-text-muted">
            Input order
          </h3>
          <div className="space-y-3 rounded-[var(--radius-lg)] border border-border-default bg-surface-0/50 p-3">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => onChange({ ...edge, inputOrder: Math.max(1, edge.inputOrder - 1) })}
                className="flex h-8 w-8 items-center justify-center rounded-full border border-border-default bg-surface-200 text-text-secondary transition hover:bg-surface-300 hover:text-text-primary"
                aria-label="Decrease"
              >
                <svg className="h-3 w-3" viewBox="0 0 12 12"><path d="M3 6h6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /></svg>
              </button>
              <div className="flex-1 rounded-[var(--radius-md)] border border-border-default bg-surface-200 px-3 py-1.5 text-center font-mono text-[13px] text-text-primary">
                {edge.inputOrder} <span className="text-text-muted">/ {count}</span>
              </div>
              <button
                type="button"
                onClick={() => onChange({ ...edge, inputOrder: Math.min(count, edge.inputOrder + 1) })}
                className="flex h-8 w-8 items-center justify-center rounded-full border border-border-default bg-surface-200 text-text-secondary transition hover:bg-surface-300 hover:text-text-primary"
                aria-label="Increase"
              >
                <svg className="h-3 w-3" viewBox="0 0 12 12"><path d="M6 3v6M3 6h6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /></svg>
              </button>
            </div>
            <p className="text-[10px] leading-relaxed text-text-muted">
              Controls stdin concatenation order on the target node when it has multiple parents.
              Lower numbers are prepended first.
            </p>
          </div>
        </section>
      </div>

      <footer className="border-t border-border-default px-4 py-3">
        <button
          type="button"
          onClick={onDelete}
          className="flex w-full items-center justify-center gap-1.5 rounded-[var(--radius-md)] bg-status-danger-soft px-3 py-2 text-[12px] font-medium text-status-danger transition hover:bg-status-danger/20"
        >
          <svg className="h-3.5 w-3.5" viewBox="0 0 14 14" fill="none">
            <path d="M3 4h8M5.5 4V2.5a.5.5 0 0 1 .5-.5h2a.5.5 0 0 1 .5.5V4M4 4l.5 7.5a.5.5 0 0 0 .5.5h4a.5.5 0 0 0 .5-.5L10 4"
              stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          Delete edge
        </button>
      </footer>
    </aside>
  );
};
