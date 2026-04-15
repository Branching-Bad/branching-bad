import { useMemo, useState } from "react";
import type { SshConnection, SshGroup, SshSessionInfo } from "../../types";
import { ConnectionCard } from "./ConnectionCard";
import { ImportExportMenu } from "./ImportExportMenu";
import { btnPrimary } from "../shared";

export function ConnectionList({
  connections,
  groups,
  sessions,
  selectedId,
  onSelect,
  onNew,
  onImportExportDone,
}: {
  connections: SshConnection[];
  groups: SshGroup[];
  sessions: SshSessionInfo[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onNew: () => void;
  onImportExportDone: () => void;
}) {
  const [query, setQuery] = useState("");

  const sessionsByConn = useMemo(() => {
    const m = new Map<string, number>();
    for (const s of sessions) m.set(s.connectionId, (m.get(s.connectionId) ?? 0) + 1);
    return m;
  }, [sessions]);

  const q = query.trim().toLowerCase();
  const matches = (c: SshConnection) =>
    !q || c.alias.toLowerCase().includes(q) || c.host.toLowerCase().includes(q) || c.username.toLowerCase().includes(q);

  const ungrouped = connections.filter((c) => !c.groupId && matches(c));
  const grouped = groups
    .map((g) => ({ group: g, items: connections.filter((c) => c.groupId === g.id && matches(c)) }))
    .filter((x) => x.items.length > 0);

  return (
    <aside className="flex h-full w-[280px] shrink-0 flex-col border-r border-border-default bg-surface-0/80">
      <div className="flex items-center gap-2 border-b border-border-default px-3 py-3">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search connections…"
          className="flex-1 rounded-md border border-border-default bg-surface-200 px-2 py-1 text-[12px] text-text-primary placeholder:text-text-muted focus:border-brand focus:outline-none"
        />
        <ImportExportMenu onDone={onImportExportDone} />
      </div>
      <div className="border-b border-border-default px-3 py-2">
        <button onClick={onNew} className={`${btnPrimary} w-full text-[11px]`}>+ New Connection</button>
      </div>
      <div className="flex-1 space-y-3 overflow-y-auto p-2">
        {ungrouped.length > 0 && (
          <div className="space-y-0.5">
            {ungrouped.map((c) => (
              <ConnectionCard key={c.id} conn={c} active={c.id === selectedId} liveSessionCount={sessionsByConn.get(c.id) ?? 0} onSelect={() => onSelect(c.id)} />
            ))}
          </div>
        )}
        {grouped.map(({ group, items }) => (
          <div key={group.id} className="space-y-0.5">
            <p className="px-3 text-[10px] font-semibold uppercase tracking-[0.1em] text-text-muted">{group.name}</p>
            {items.map((c) => (
              <ConnectionCard key={c.id} conn={c} active={c.id === selectedId} liveSessionCount={sessionsByConn.get(c.id) ?? 0} onSelect={() => onSelect(c.id)} />
            ))}
          </div>
        ))}
        {ungrouped.length === 0 && grouped.length === 0 && (
          <p className="p-4 text-center text-[11px] italic text-text-muted">
            {q ? 'No matches.' : 'No connections. Click + New Connection.'}
          </p>
        )}
      </div>
    </aside>
  );
}
