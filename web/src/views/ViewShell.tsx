import type { ReactNode } from "react";

export function ViewShell({
  title,
  subtitle,
  actions,
  children,
}: {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="sticky top-0 z-10 flex items-center justify-between border-b border-border-default bg-surface-100/80 px-6 py-4 backdrop-blur-md">
        <div className="min-w-0">
          <h2 className="truncate text-[15px] font-semibold text-text-primary">{title}</h2>
          {subtitle && (
            <p className="mt-0.5 truncate text-[11px] text-text-muted">{subtitle}</p>
          )}
        </div>
        {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
      </header>
      <div className="flex-1 overflow-y-auto px-6 py-5">
        {children}
      </div>
    </div>
  );
}
