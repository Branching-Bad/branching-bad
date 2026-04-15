import { type FC, useEffect, useState } from 'react';
import { mcpApi } from './api';
import type { McpServer } from './types';

interface Props {
  profileId: string;
}

export const AgentProfileMcpPanel: FC<Props> = ({ profileId }) => {
  const [all, setAll] = useState<McpServer[]>([]);
  const [assigned, setAssigned] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    Promise.all([mcpApi.list(), mcpApi.listForProfile(profileId)])
      .then(([list, mine]) => {
        if (cancelled) return;
        setAll(list);
        setAssigned(new Set(mine.map((s) => s.id)));
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [profileId]);

  const toggle = async (id: string) => {
    const next = new Set(assigned);
    if (next.has(id)) next.delete(id); else next.add(id);
    setAssigned(next);
    await mcpApi.setForProfile(profileId, Array.from(next));
  };

  if (loading) return <div className="text-[11px] text-text-muted">Loading MCPs…</div>;
  if (all.length === 0) {
    return (
      <p className="text-[11px] text-text-muted">
        No MCP servers installed. Add one from the Extensions drawer.
      </p>
    );
  }

  return (
    <div className="space-y-1">
      {all.map((s) => (
        <label
          key={s.id}
          className="flex cursor-pointer items-center gap-2 rounded-[var(--radius-md)] px-2 py-1.5 text-[12px] text-text-primary transition hover:bg-surface-200"
        >
          <input
            type="checkbox"
            checked={assigned.has(s.id)}
            onChange={() => void toggle(s.id)}
          />
          <span className="flex-1 truncate">{s.name}</span>
          <span className="text-[10px] text-text-muted">{s.catalog_id}</span>
        </label>
      ))}
    </div>
  );
};
