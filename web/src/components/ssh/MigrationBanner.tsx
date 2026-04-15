export function MigrationBanner({
  sourcePath,
  onImport,
  onDismiss,
}: {
  sourcePath: string;
  onImport: () => void;
  onDismiss: () => void;
}) {
  return (
    <div className="m-3 flex items-center gap-3 rounded-[var(--radius-md)] border border-brand-glow bg-brand-tint px-4 py-2.5">
      <div className="flex-1 text-[12px] text-text-primary">
        Found existing SSHMaster connections at <code className="text-text-secondary">{sourcePath}</code>.
      </div>
      <button onClick={onImport} className="rounded-md bg-brand px-3 py-1 text-[11px] font-medium text-white hover:bg-brand/80">Import</button>
      <button onClick={onDismiss} className="rounded-md bg-surface-200 px-3 py-1 text-[11px] font-medium text-text-secondary hover:text-text-primary">Dismiss</button>
    </div>
  );
}
