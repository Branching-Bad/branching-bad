import { type FC, useMemo, useState } from 'react';
import type { McpCatalog, McpCatalogEntry, McpInstallPayload, McpTestResult } from './types';
import { McpEditorMonaco } from './McpEditorMonaco';
import { mcpApi } from './api';

interface Props {
  catalog: McpCatalog;
  catalogId: string;
  onCancel: () => void;
  onSave: (payload: McpInstallPayload) => Promise<void>;
}

function defaultForEntry(entry: McpCatalogEntry): Record<string, unknown> {
  const props = (entry.envSchema as { properties?: Record<string, { default?: unknown }> }).properties ?? {};
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(props)) {
    if ('default' in v) out[k] = v.default;
    else out[k] = '';
  }
  return out;
}

export const McpInstallModal: FC<Props> = ({ catalog, catalogId, onCancel, onSave }) => {
  const entry = catalog.entries[catalogId];
  const [name, setName] = useState<string>(`${catalogId}-1`);
  const [configText, setConfigText] = useState<string>(() => JSON.stringify(defaultForEntry(entry), null, 2));
  const [secrets, setSecrets] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<McpTestResult | null>(null);
  const [testing, setTesting] = useState(false);

  const secretKeys = useMemo(() => {
    const props = (entry.envSchema as { properties?: Record<string, { format?: string }> }).properties ?? {};
    return Object.keys(props).filter((k) => props[k].format === 'secret');
  }, [entry]);

  const parse = (): Record<string, unknown> | null => {
    try { return JSON.parse(configText); } catch { return null; }
  };

  const testDraft = async () => {
    const parsed = parse();
    if (!parsed) { setError('config JSON invalid'); return; }
    setTesting(true); setError(null); setTestResult(null);
    try {
      const tmp = await mcpApi.create({ catalogId, name: `__test_${Date.now()}`, configJson: parsed, secrets });
      try {
        const r = await mcpApi.test(tmp.id);
        setTestResult(r);
      } finally {
        await mcpApi.delete(tmp.id);
      }
    } catch (e) {
      setError(String((e as Error).message));
    } finally {
      setTesting(false);
    }
  };

  const save = async () => {
    const parsed = parse();
    if (!parsed) { setError('config JSON invalid'); return; }
    setSaving(true); setError(null);
    try {
      await onSave({ catalogId, name, configJson: parsed, secrets });
    } catch (e) {
      setError(String((e as Error).message));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-6">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onCancel} />

      <div className="relative flex h-[min(85vh,720px)] w-full max-w-4xl flex-col overflow-hidden rounded-[var(--radius-2xl)] border border-border-default bg-surface-100 shadow-[var(--shadow-lg)]">
        <header className="flex items-center justify-between gap-3 border-b border-border-default bg-surface-100/70 px-5 py-3 backdrop-blur-md">
          <div className="flex items-center gap-2">
            <span className="rounded-full bg-brand-tint px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.1em] text-brand">
              Install MCP
            </span>
            <h2 className="text-[14px] font-semibold text-text-primary">{entry.displayName}</h2>
            {entry.publisher && <span className="text-[11px] text-text-muted">· {entry.publisher}</span>}
          </div>
          <button
            type="button"
            onClick={onCancel}
            aria-label="Close"
            className="flex h-7 w-7 items-center justify-center rounded-full text-text-muted transition hover:bg-surface-200 hover:text-text-primary"
          >
            <svg className="h-3.5 w-3.5" viewBox="0 0 14 14" fill="none">
              <path d="M3 3l8 8M11 3l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </button>
        </header>

        <div className="flex-1 space-y-4 overflow-auto px-5 py-4">
          <label className="block space-y-1">
            <span className="text-[11px] font-medium text-text-secondary">Instance name</span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full rounded-[var(--radius-md)] border border-border-default bg-surface-200 px-2.5 py-1.5 text-[12px] text-text-primary focus:border-border-focus focus:outline-none focus:shadow-[0_0_0_3px_var(--color-brand-glow)]"
            />
          </label>

          {secretKeys.length > 0 && (
            <div className="space-y-2">
              <h4 className="text-[10px] font-semibold uppercase tracking-[0.12em] text-text-muted">Secrets</h4>
              <div className="space-y-2 rounded-[var(--radius-lg)] border border-border-default bg-surface-0/40 p-3">
                {secretKeys.map((k) => (
                  <label key={k} className="block space-y-1">
                    <span className="text-[11px] font-medium text-text-secondary">{k}</span>
                    <input
                      type="password"
                      value={secrets[k] ?? ''}
                      onChange={(e) => setSecrets((prev) => ({ ...prev, [k]: e.target.value }))}
                      className="w-full rounded-[var(--radius-md)] border border-border-default bg-surface-200 px-2.5 py-1.5 text-[12px] font-mono text-text-primary focus:border-border-focus focus:outline-none focus:shadow-[0_0_0_3px_var(--color-brand-glow)]"
                    />
                  </label>
                ))}
                <p className="text-[10px] leading-relaxed text-text-muted">
                  Secrets are stored in the OS keychain (or encrypted on disk if unavailable) and never appear in the config JSON.
                </p>
              </div>
            </div>
          )}

          <div className="space-y-2">
            <h4 className="text-[10px] font-semibold uppercase tracking-[0.12em] text-text-muted">Config</h4>
            <McpEditorMonaco catalog={catalog} catalogId={catalogId} value={configText} onChange={setConfigText} />
          </div>

          {testResult && (
            <div className={`rounded-[var(--radius-md)] border px-3 py-2 text-[12px] ${
              testResult.ok
                ? 'border-status-success/30 bg-status-success-soft text-status-success'
                : 'border-status-danger/30 bg-status-danger-soft text-status-danger'
            }`}>
              {testResult.ok
                ? `\u2713 ${testResult.tools.length} tools available`
                : `\u2717 ${testResult.error ?? 'failed'}`}
              {testResult.stderr && (
                <pre className="mt-1 max-h-32 overflow-auto whitespace-pre-wrap font-mono text-[10px] opacity-80">
                  {testResult.stderr}
                </pre>
              )}
            </div>
          )}
          {error && (
            <div className="rounded-[var(--radius-md)] border border-status-danger/30 bg-status-danger-soft px-3 py-2 text-[12px] text-status-danger">
              {error}
            </div>
          )}
        </div>

        <footer className="flex items-center justify-between gap-2 border-t border-border-default bg-surface-100/70 px-5 py-3 backdrop-blur-md">
          <button
            type="button"
            onClick={() => void testDraft()}
            disabled={testing}
            className="rounded-full border border-border-default bg-surface-200 px-3 py-1 text-[11px] font-medium text-text-secondary transition hover:bg-surface-300 hover:text-text-primary disabled:opacity-40"
          >
            {testing ? 'Testing\u2026' : 'Test connection'}
          </button>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onCancel}
              className="rounded-full border border-border-default bg-surface-200 px-3 py-1 text-[11px] font-medium text-text-secondary transition hover:bg-surface-300 hover:text-text-primary"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => void save()}
              disabled={saving || !name.trim()}
              className="rounded-full bg-brand px-3 py-1 text-[11px] font-semibold text-white shadow-[0_1px_2px_rgba(0,0,0,0.2)] transition hover:bg-brand-dark disabled:opacity-40"
            >
              {saving ? 'Saving\u2026' : 'Install'}
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
};
