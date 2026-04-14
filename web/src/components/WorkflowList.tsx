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
    <aside className="w-64 border-r border-border-default flex flex-col bg-surface-100">
      <div className="p-3 flex gap-2 border-b border-border-default">
        <input
          className="flex-1 bg-surface-200 border border-border-default px-2 py-1 rounded-[var(--radius-sm)] text-sm text-text-primary placeholder-text-muted focus:outline-none focus:border-border-focus"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="New workflow name"
          onKeyDown={(e) => { if (e.key === 'Enter') void create(); }}
        />
        <button
          className="bg-brand hover:bg-brand-dark text-white px-2 rounded-[var(--radius-sm)] text-sm transition-colors"
          onClick={() => void create()}
        >
          +
        </button>
      </div>
      <ul className="flex-1 overflow-auto py-1">
        {workflows.length === 0 && (
          <li className="px-3 py-6 text-center text-xs text-text-muted">No workflows yet</li>
        )}
        {workflows.map((wf) => (
          <li key={wf.id}>
            <button
              className={`w-full text-left px-3 py-2 text-sm transition-colors ${
                selectedId === wf.id
                  ? 'bg-brand/10 text-text-primary'
                  : 'text-text-secondary hover:bg-surface-200'
              }`}
              onClick={() => onSelect(wf.id)}
            >
              <span className="truncate block">{wf.name}</span>
              {wf.cron_enabled && (
                <span className="text-[10px] text-status-warning">cron</span>
              )}
            </button>
          </li>
        ))}
      </ul>
    </aside>
  );
};
