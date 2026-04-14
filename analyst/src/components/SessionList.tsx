import type { AnalystHistoryEntry } from "../types";
import { formatRelative } from "../hooks/useRelativeTime";
import { IconTrash, IconMessage } from "./Icons";

interface Props {
  entries: AnalystHistoryEntry[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
}

function groupByDate(entries: AnalystHistoryEntry[]) {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const yesterday = today - 86400000;
  const weekAgo = today - 604800000;

  const groups: { label: string; items: AnalystHistoryEntry[] }[] = [
    { label: "Today", items: [] },
    { label: "Yesterday", items: [] },
    { label: "This Week", items: [] },
    { label: "Older", items: [] },
  ];

  for (const entry of entries) {
    if (entry.timestamp >= today) groups[0].items.push(entry);
    else if (entry.timestamp >= yesterday) groups[1].items.push(entry);
    else if (entry.timestamp >= weekAgo) groups[2].items.push(entry);
    else groups[3].items.push(entry);
  }

  return groups.filter((g) => g.items.length > 0);
}

export default function SessionList({ entries, activeId, onSelect, onDelete }: Props) {
  const groups = groupByDate(entries);

  if (entries.length === 0) {
    return (
      <div className="px-3 py-8 text-center">
        <p className="text-xs text-text-muted">No previous sessions</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {groups.map((group) => (
        <div key={group.label}>
          <div className="px-3 py-1">
            <span className="text-[10px] font-semibold text-text-muted uppercase tracking-wider">{group.label}</span>
          </div>
          <div className="flex flex-col gap-0.5">
            {group.items.map((entry) => (
              <button
                key={entry.id}
                onClick={() => onSelect(entry.id)}
                className={`group w-full text-left px-3 py-2 rounded-lg transition-all ${
                  activeId === entry.id
                    ? "bg-brand/8 border border-brand/15"
                    : "hover:bg-surface-300 border border-transparent"
                }`}
              >
                <div className="flex items-start gap-2">
                  <IconMessage className={`w-3.5 h-3.5 mt-0.5 flex-shrink-0 ${
                    activeId === entry.id ? "text-brand" : "text-text-muted"
                  }`} />
                  <div className="flex-1 min-w-0">
                    <span className={`block text-xs truncate ${
                      activeId === entry.id ? "text-text-primary font-medium" : "text-text-secondary"
                    }`}>
                      {entry.title ?? entry.firstMessage}
                    </span>
                    <span className="block text-[10px] text-text-muted mt-0.5">
                      {formatRelative(entry.timestamp)}
                    </span>
                  </div>
                  <button
                    onClick={(e) => { e.stopPropagation(); onDelete(entry.id); }}
                    className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-status-danger-soft text-text-muted hover:text-status-danger transition-all"
                    title="Delete session"
                  >
                    <IconTrash />
                  </button>
                </div>
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
