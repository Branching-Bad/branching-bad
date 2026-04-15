import type { SshConnection } from "../../types";

export function ConnectionCard({
  conn,
  active,
  liveSessionCount,
  onSelect,
}: {
  conn: SshConnection;
  active: boolean;
  liveSessionCount: number;
  onSelect: () => void;
}) {
  const hasLive = liveSessionCount > 0;
  return (
    <button
      onClick={onSelect}
      className={`group flex w-full items-center gap-2 rounded-[var(--radius-md)] px-3 py-2 text-left transition ${
        active
          ? "bg-brand-tint text-text-primary shadow-[inset_0_0_0_1px_var(--color-brand-glow)]"
          : "text-text-secondary hover:bg-surface-200 hover:text-text-primary"
      }`}
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="truncate text-[13px] font-medium">{conn.alias}</span>
          {hasLive && (
            <span
              className="inline-block h-1.5 w-1.5 rounded-full bg-status-success"
              style={{ animation: 'ssh-pulse 1.5s ease-in-out infinite' }}
              aria-label="active session"
            />
          )}
        </div>
        <p className="truncate text-[11px] text-text-muted">
          {conn.username}@{conn.host}{conn.port !== 22 ? `:${conn.port}` : ''}
        </p>
      </div>
      {hasLive && (
        <span className="shrink-0 rounded-full bg-status-success/20 px-1.5 py-0.5 text-[10px] font-medium text-status-success">
          {liveSessionCount}
        </span>
      )}
    </button>
  );
}
