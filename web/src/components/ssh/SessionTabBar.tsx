export function SessionTabBar({
  tabs,
  activeTabId,
  onSelect,
  onClose,
  onNew,
}: {
  tabs: { id: string; label: string }[];
  activeTabId: string | null;
  onSelect: (id: string) => void;
  onClose: (id: string) => void;
  onNew: () => void;
}) {
  return (
    <div className="flex items-center gap-0.5 border-b border-border-default bg-surface-100/70 px-2 py-1 backdrop-blur-md">
      {tabs.map((t) => {
        const active = t.id === activeTabId;
        return (
          <div
            key={t.id}
            className={`group flex items-center gap-1.5 rounded-t-md px-3 py-1 text-[12px] transition ${
              active
                ? "bg-surface-0 text-text-primary shadow-[inset_0_0_0_1px_var(--color-border-default)]"
                : "text-text-secondary hover:bg-surface-200"
            }`}
          >
            <button onClick={() => onSelect(t.id)} className="font-medium">{t.label}</button>
            <button
              onClick={(e) => { e.stopPropagation(); onClose(t.id); }}
              className="rounded-full px-1 text-text-muted opacity-0 transition hover:bg-surface-300 hover:text-text-primary group-hover:opacity-100"
              aria-label={`Close ${t.label}`}
            >
              ×
            </button>
          </div>
        );
      })}
      <button
        onClick={onNew}
        className="ml-1 flex h-6 w-6 items-center justify-center rounded-md text-text-muted transition hover:bg-surface-200 hover:text-text-primary"
        title="New terminal session"
      >
        +
      </button>
    </div>
  );
}
