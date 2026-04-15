import { type FC, useState } from 'react';
import { useMcpServers } from './useMcpServers';
import { McpInstallModal } from './McpInstallModal';

export const McpTab: FC = () => {
  const { catalog, servers, install, remove, test } = useMcpServers();
  const [installingId, setInstallingId] = useState<string | null>(null);
  const [galleryOpen, setGalleryOpen] = useState(false);

  if (!catalog) return <div className="text-[11px] text-text-muted">Loading catalog…</div>;

  return (
    <div className="space-y-3">
      <header className="flex items-center justify-between">
        <div>
          <h3 className="text-[13px] font-medium text-text-primary">MCP servers</h3>
          <p className="text-[10px] text-text-muted">{servers.length} installed</p>
        </div>
        <button
          type="button"
          onClick={() => setGalleryOpen(true)}
          className="flex items-center gap-1.5 rounded-full bg-brand px-3 py-1 text-[11px] font-semibold text-white shadow-[0_1px_2px_rgba(0,0,0,0.2)] hover:bg-brand-dark"
        >
          <svg className="h-3 w-3" viewBox="0 0 12 12" fill="none">
            <path d="M6 2v8M2 6h8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
          </svg>
          Add MCP
        </button>
      </header>

      {servers.length === 0 && (
        <div className="rounded-[var(--radius-lg)] border border-dashed border-border-default/60 px-3 py-6 text-center text-[11px] text-text-muted">
          No MCP servers installed. Click Add MCP to browse the catalog.
        </div>
      )}

      <ul className="space-y-1.5">
        {servers.map((s) => {
          const entry = catalog.entries[s.catalog_id];
          return (
            <li key={s.id} className="flex items-center gap-2 rounded-[var(--radius-md)] border border-border-default bg-surface-0/40 px-3 py-2">
              <span className={`h-1.5 w-1.5 rounded-full ${s.enabled ? 'bg-status-success' : 'bg-text-muted/60'}`} />
              <div className="flex-1 min-w-0">
                <div className="truncate text-[12px] font-medium text-text-primary">{s.name}</div>
                <div className="truncate text-[10px] text-text-muted">{entry?.displayName ?? s.catalog_id}</div>
              </div>
              <button
                type="button"
                onClick={() => void test(s.id).then((r) => alert(r.ok ? `✓ ${r.tools.length} tools` : `✗ ${r.error ?? 'failed'}`))}
                className="rounded-full border border-border-default bg-surface-200 px-2 py-0.5 text-[10px] text-text-secondary hover:bg-surface-300 hover:text-text-primary"
              >
                Test
              </button>
              <button
                type="button"
                onClick={() => void remove(s.id)}
                className="rounded-full bg-status-danger-soft px-2 py-0.5 text-[10px] text-status-danger hover:bg-status-danger/20"
              >
                Remove
              </button>
            </li>
          );
        })}
      </ul>

      {galleryOpen && (
        <div className="fixed inset-0 z-[68] flex items-center justify-center p-6">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setGalleryOpen(false)} />
          <div className="relative w-full max-w-3xl rounded-[var(--radius-2xl)] border border-border-default bg-surface-100 p-5 shadow-[var(--shadow-lg)]">
            <h3 className="mb-3 text-[14px] font-semibold text-text-primary">MCP catalog</h3>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {Object.entries(catalog.entries).map(([id, entry]) => (
                <button
                  key={id}
                  onClick={() => { setGalleryOpen(false); setInstallingId(id); }}
                  className="flex flex-col items-start gap-1 rounded-[var(--radius-lg)] border border-border-default bg-surface-0/40 px-3 py-3 text-left transition hover:border-border-strong hover:bg-surface-200"
                >
                  <span className="text-[12px] font-medium text-text-primary">{entry.displayName}</span>
                  {entry.publisher && <span className="text-[10px] text-text-muted">{entry.publisher}</span>}
                  {entry.description && <span className="mt-1 text-[11px] leading-relaxed text-text-secondary">{entry.description}</span>}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {installingId && (
        <McpInstallModal
          catalog={catalog}
          catalogId={installingId}
          onCancel={() => setInstallingId(null)}
          onSave={async (p) => {
            await install(p);
            setInstallingId(null);
          }}
        />
      )}
    </div>
  );
};
