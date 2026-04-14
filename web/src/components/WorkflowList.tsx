import { type FC, useState } from 'react';
import type { Workflow } from '../types/workflow';
import { workflowApi } from '../api/workflow';

interface Props {
  repoId: string;
  workflows: Workflow[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onCreated: () => void;
}

export const WorkflowList: FC<Props> = ({ repoId, workflows, selectedId, onSelect, onCreated }) => {
  const [draft, setDraft] = useState('');

  const create = async () => {
    const name = draft.trim();
    if (!name) return;
    const wf = await workflowApi.create(repoId, name, { nodes: [], edges: [] });
    setDraft('');
    onCreated();
    onSelect(wf.id);
  };

  return (
    <aside className="flex w-72 shrink-0 flex-col overflow-hidden rounded-[var(--radius-xl)] border border-border-default bg-surface-100 shadow-[var(--shadow-md)]">
      <header className="flex items-center justify-between px-4 pt-4 pb-3">
        <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-text-muted">
          Workflows
        </span>
        <span className="text-[11px] tabular-nums text-text-muted">{workflows.length}</span>
      </header>

      <div className="px-3 pb-3">
        <div className="flex items-center gap-1.5 rounded-[var(--radius-md)] border border-border-default bg-surface-200 px-2.5 py-1.5 transition focus-within:border-border-focus focus-within:shadow-[0_0_0_3px_var(--color-brand-glow)]">
          <svg className="h-3.5 w-3.5 shrink-0 text-text-muted" viewBox="0 0 16 16" fill="none">
            <path d="M12 12L15 15M7 13A6 6 0 1 1 7 1a6 6 0 0 1 0 12Z" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
          </svg>
          <input
            className="flex-1 bg-transparent text-[13px] text-text-primary placeholder:text-text-muted focus:outline-none"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="New workflow"
            onKeyDown={(e) => { if (e.key === 'Enter') void create(); }}
          />
          <button
            type="button"
            onClick={() => void create()}
            disabled={!draft.trim()}
            className="flex h-5 w-5 items-center justify-center rounded-full bg-brand text-white transition hover:bg-brand-dark disabled:bg-surface-300 disabled:text-text-muted"
            aria-label="Create workflow"
          >
            <svg className="h-3 w-3" viewBox="0 0 12 12" fill="none">
              <path d="M6 2v8M2 6h8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
            </svg>
          </button>
        </div>
      </div>

      <div className="mx-3 mb-1 border-t border-border-default/60" />

      <ul className="flex-1 overflow-auto px-2 pb-3">
        {workflows.length === 0 && (
          <li className="px-3 py-10 text-center text-xs text-text-muted">
            No workflows yet
          </li>
        )}
        {workflows.map((wf) => {
          const active = selectedId === wf.id;
          return (
            <li key={wf.id} className="mt-0.5">
              <button
                onClick={() => onSelect(wf.id)}
                className={`group flex w-full items-center gap-2 rounded-[var(--radius-md)] px-2.5 py-1.5 text-left text-[13px] transition ${
                  active
                    ? 'bg-brand-tint text-text-primary shadow-[inset_0_0_0_1px_var(--color-brand-glow)]'
                    : 'text-text-secondary hover:bg-surface-200 hover:text-text-primary'
                }`}
              >
                <span
                  className={`inline-block h-1.5 w-1.5 shrink-0 rounded-full transition ${
                    active ? 'bg-brand' : 'bg-text-muted/40 group-hover:bg-text-muted'
                  }`}
                />
                <span className="flex-1 truncate">{wf.name}</span>
                {wf.cron_enabled && (
                  <span className="rounded-full bg-status-warning-soft px-1.5 py-0 text-[9px] font-medium uppercase tracking-wider text-status-warning">
                    cron
                  </span>
                )}
              </button>
            </li>
          );
        })}
      </ul>
    </aside>
  );
};
