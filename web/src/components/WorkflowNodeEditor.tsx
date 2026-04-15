import { useEffect, useState, type FC, type ReactNode } from 'react';
import Editor from '@monaco-editor/react';
import type { Graph, GraphNode, ScriptNode, AgentNode, Edge } from '../types/workflow';

interface Props {
  node: GraphNode;
  graph: Graph;
  agentProfiles: Array<{ id: string; name: string }>;
  onChange: (next: GraphNode) => void;
  onGraphChange: (next: Graph) => void;
  onDelete: () => void;
  onClose: () => void;
}

const KIND_LABEL: Record<GraphNode['kind'], string> = {
  script: 'Script',
  agent: 'Agent',
  merge: 'Merge',
};

export const WorkflowNodeEditor: FC<Props> = ({ node, graph, agentProfiles, onChange, onGraphChange, onDelete, onClose }) => (
  <aside className="m-3 flex w-[380px] shrink-0 flex-col overflow-hidden rounded-[var(--radius-xl)] border border-border-default bg-surface-100 shadow-[var(--shadow-md)]">
    <header className="flex items-center justify-between gap-2 border-b border-border-default px-4 py-3">
      <div className="flex items-center gap-2">
        <span className="rounded-full bg-brand-tint px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.1em] text-brand">
          {KIND_LABEL[node.kind]}
        </span>
        <span className="text-[13px] font-medium text-text-primary">Inspector</span>
      </div>
      <button
        type="button"
        onClick={onClose}
        aria-label="Close inspector"
        className="flex h-7 w-7 items-center justify-center rounded-full text-text-muted transition hover:bg-surface-200 hover:text-text-primary"
      >
        <svg className="h-3.5 w-3.5" viewBox="0 0 14 14" fill="none">
          <path d="M3 3l8 8M11 3l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      </button>
    </header>

    <div className="flex-1 space-y-5 overflow-auto px-4 py-4">
      <Section title="General">
        <Field label="Label">
          <TextInput
            value={node.label}
            onChange={(v) => onChange({ ...node, label: v })}
            placeholder="Node name"
          />
        </Field>
        <Field label="On failure" hint="halt-subtree stops just downstream; halt-all cancels the whole run">
          <Select
            value={node.onFail}
            onChange={(v) => onChange({ ...node, onFail: v as GraphNode['onFail'] })}
            options={[
              { v: 'halt-subtree', label: 'Halt subtree' },
              { v: 'halt-all', label: 'Halt all branches' },
            ]}
          />
        </Field>
      </Section>

      {node.kind === 'script' && (
        <ScriptSection node={node} onChange={onChange as (n: ScriptNode) => void} />
      )}
      {node.kind === 'agent' && (
        <AgentSection node={node} onChange={onChange as (n: AgentNode) => void} profiles={agentProfiles} />
      )}
      {node.kind === 'merge' && (
        <Section title="Merge">
          <p className="text-[12px] leading-relaxed text-text-secondary">
            Concatenates incoming stdouts by their input order and pipes the result downstream.
          </p>
        </Section>
      )}

      <InputsSection node={node} graph={graph} onGraphChange={onGraphChange} />
    </div>

    <footer className="border-t border-border-default px-4 py-3">
      <button
        type="button"
        onClick={onDelete}
        className="flex w-full items-center justify-center gap-1.5 rounded-[var(--radius-md)] bg-status-danger-soft px-3 py-2 text-[12px] font-medium text-status-danger transition hover:bg-status-danger/20"
      >
        <svg className="h-3.5 w-3.5" viewBox="0 0 14 14" fill="none">
          <path d="M3 4h8M5.5 4V2.5a.5.5 0 0 1 .5-.5h2a.5.5 0 0 1 .5.5V4M4 4l.5 7.5a.5.5 0 0 0 .5.5h4a.5.5 0 0 0 .5-.5L10 4"
            stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        Delete node
      </button>
    </footer>
  </aside>
);

// ── primitives ───────────────────────────────────────────────────────────────

const Section: FC<{ title: string; children: ReactNode }> = ({ title, children }) => (
  <section className="space-y-3">
    <h3 className="text-[10px] font-semibold uppercase tracking-[0.12em] text-text-muted">
      {title}
    </h3>
    <div className="space-y-3 rounded-[var(--radius-lg)] border border-border-default bg-surface-0/50 p-3">
      {children}
    </div>
  </section>
);

const Field: FC<{ label: string; hint?: string; children: ReactNode }> = ({ label, hint, children }) => (
  <div className="space-y-1.5">
    <label className="text-[11px] font-medium text-text-secondary">{label}</label>
    {children}
    {hint && <p className="text-[10px] leading-relaxed text-text-muted">{hint}</p>}
  </div>
);

const TextInput: FC<{ value: string; onChange: (v: string) => void; placeholder?: string; mono?: boolean }> = ({ value, onChange, placeholder, mono }) => (
  <input
    value={value}
    placeholder={placeholder}
    onChange={(e) => onChange(e.target.value)}
    className={`w-full rounded-[var(--radius-md)] border border-border-default bg-surface-200 px-2.5 py-1.5 text-[12px] text-text-primary placeholder:text-text-muted transition focus:border-border-focus focus:outline-none focus:shadow-[0_0_0_3px_var(--color-brand-glow)] ${
      mono ? 'font-mono' : ''
    }`}
  />
);

const Select: FC<{ value: string; onChange: (v: string) => void; options: Array<{ v: string; label: string }> }> = ({ value, onChange, options }) => (
  <div className="relative">
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="w-full appearance-none rounded-[var(--radius-md)] border border-border-default bg-surface-200 px-2.5 py-1.5 pr-8 text-[12px] text-text-primary transition focus:border-border-focus focus:outline-none focus:shadow-[0_0_0_3px_var(--color-brand-glow)]"
    >
      {options.map((o) => (
        <option key={o.v} value={o.v}>{o.label}</option>
      ))}
    </select>
    <svg className="pointer-events-none absolute right-2.5 top-2.5 h-3 w-3 text-text-muted" viewBox="0 0 12 12">
      <path d="M3 4.5L6 7.5L9 4.5" stroke="currentColor" strokeWidth="1.4" fill="none" strokeLinecap="round" />
    </svg>
  </div>
);

// ── sections ─────────────────────────────────────────────────────────────────

const InputsSection: FC<{ node: GraphNode; graph: Graph; onGraphChange: (g: Graph) => void }> = ({ node, graph, onGraphChange }) => {
  const incoming = graph.edges
    .filter((e) => e.to === node.id)
    .sort((a, b) => a.inputOrder - b.inputOrder);

  if (incoming.length === 0) return null;

  const nodeLabel = (id: string) => graph.nodes.find((n) => n.id === id)?.label ?? id.slice(0, 6);

  const renumber = (edges: Edge[]): Edge[] => {
    const others = graph.edges.filter((e) => e.to !== node.id);
    const remapped = edges.map((e, i) => ({ ...e, inputOrder: i + 1 }));
    return [...others, ...remapped];
  };

  const move = (idx: number, dir: -1 | 1) => {
    const next = [...incoming];
    const j = idx + dir;
    if (j < 0 || j >= next.length) return;
    [next[idx], next[j]] = [next[j], next[idx]];
    onGraphChange({ ...graph, edges: renumber(next) });
  };

  const toggleRequired = (edgeId: string) => {
    const next = incoming.map((e) => (e.id === edgeId ? { ...e, required: !e.required } : e));
    onGraphChange({ ...graph, edges: renumber(next) });
  };

  const remove = (edgeId: string) => {
    const next = incoming.filter((e) => e.id !== edgeId);
    onGraphChange({ ...graph, edges: renumber(next) });
  };

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-[10px] font-semibold uppercase tracking-[0.12em] text-text-muted">
          Inputs
          <span className="ml-1.5 font-normal normal-case tracking-normal text-text-muted/70">
            stdin order
          </span>
        </h3>
        <span className="text-[10px] text-text-muted">{incoming.length}</span>
      </div>
      <div className="overflow-hidden rounded-[var(--radius-lg)] border border-border-default bg-surface-0/50">
        {incoming.map((edge, idx) => (
          <div
            key={edge.id}
            className={`flex items-center gap-2 px-2.5 py-1.5 text-[12px] ${
              idx > 0 ? 'border-t border-border-default/50' : ''
            }`}
          >
            <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-brand-tint text-[10px] font-semibold text-brand">
              {edge.inputOrder}
            </span>
            <span className="flex-1 truncate text-text-primary" title={nodeLabel(edge.from)}>
              {nodeLabel(edge.from)}
            </span>
            <button
              type="button"
              onClick={() => toggleRequired(edge.id)}
              title={edge.required ? 'Required — failed source skips this node' : 'Optional — failed source does not block this node'}
              className={`rounded-full px-1.5 py-0 text-[9px] font-medium uppercase tracking-wider transition ${
                edge.required
                  ? 'bg-status-warning-soft text-status-warning hover:bg-status-warning/20'
                  : 'bg-surface-200 text-text-muted hover:bg-surface-300 hover:text-text-secondary'
              }`}
            >
              {edge.required ? 'req' : 'opt'}
            </button>
            <div className="flex items-center gap-0.5">
              <button
                type="button"
                onClick={() => move(idx, -1)}
                disabled={idx === 0}
                aria-label="Move up"
                className="flex h-5 w-5 items-center justify-center rounded-full text-text-muted transition hover:bg-surface-200 hover:text-text-primary disabled:opacity-30 disabled:hover:bg-transparent"
              >
                <svg className="h-2.5 w-2.5" viewBox="0 0 10 10" fill="none">
                  <path d="M2.5 6L5 3.5L7.5 6" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
              <button
                type="button"
                onClick={() => move(idx, 1)}
                disabled={idx === incoming.length - 1}
                aria-label="Move down"
                className="flex h-5 w-5 items-center justify-center rounded-full text-text-muted transition hover:bg-surface-200 hover:text-text-primary disabled:opacity-30 disabled:hover:bg-transparent"
              >
                <svg className="h-2.5 w-2.5" viewBox="0 0 10 10" fill="none">
                  <path d="M2.5 4L5 6.5L7.5 4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
              <button
                type="button"
                onClick={() => remove(edge.id)}
                aria-label="Remove input"
                className="flex h-5 w-5 items-center justify-center rounded-full text-text-muted transition hover:bg-status-danger/20 hover:text-status-danger"
              >
                <svg className="h-2.5 w-2.5" viewBox="0 0 10 10" fill="none">
                  <path d="M2 2l6 6M8 2l-6 6" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
                </svg>
              </button>
            </div>
          </div>
        ))}
      </div>
      {incoming.length > 1 && (
        <p className="px-1 text-[10px] leading-relaxed text-text-muted">
          Parent stdouts are concatenated in this order and piped to stdin. Use ↑/↓ to reorder.
        </p>
      )}
    </section>
  );
};

const ScriptSection: FC<{ node: ScriptNode; onChange: (n: ScriptNode) => void }> = ({ node, onChange }) => (
  <>
    <Section title="Runtime">
      <Field label="Language">
        <Select
          value={node.lang}
          onChange={(v) => onChange({ ...node, lang: v as ScriptNode['lang'] })}
          options={[
            { v: 'python', label: 'Python' },
            { v: 'typescript', label: 'TypeScript' },
            { v: 'csharp', label: 'C#' },
            { v: 'custom', label: 'Custom' },
          ]}
        />
      </Field>
      <Field label="Source">
        <div className="flex rounded-[var(--radius-md)] border border-border-default bg-surface-200 p-0.5">
          {(['inline', 'file'] as const).map((src) => (
            <button
              key={src}
              type="button"
              onClick={() => onChange({ ...node, source: src })}
              className={`flex-1 rounded-[7px] px-2 py-1 text-[11px] font-medium transition ${
                node.source === src
                  ? 'bg-surface-0 text-text-primary shadow-sm'
                  : 'text-text-muted hover:text-text-secondary'
              }`}
            >
              {src === 'inline' ? 'Inline' : 'File path'}
            </button>
          ))}
        </div>
      </Field>
      {node.lang === 'custom' && (
        <Field label="Run command" hint="Use {file} placeholder for the script path">
          <TextInput
            value={node.runCommand ?? ''}
            onChange={(v) => onChange({ ...node, runCommand: v })}
            placeholder="dotnet script {file}"
            mono
          />
        </Field>
      )}
    </Section>

    {node.source === 'file' ? (
      <Section title="File">
        <Field label="Path (repo-relative)">
          <TextInput
            value={node.filePath ?? ''}
            onChange={(v) => onChange({ ...node, filePath: v })}
            placeholder="scripts/fetch.py"
            mono
          />
        </Field>
      </Section>
    ) : (
      <CodeSection node={node} onChange={onChange} />
    )}
  </>
);

const CodeSection: FC<{ node: ScriptNode; onChange: (n: ScriptNode) => void }> = ({ node, onChange }) => {
  const [expanded, setExpanded] = useState(false);
  const monacoLang =
    node.lang === 'python'     ? 'python'     :
    node.lang === 'typescript' ? 'typescript' :
    node.lang === 'csharp'     ? 'csharp'     :
    'shell';

  useEffect(() => {
    if (!expanded) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setExpanded(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [expanded]);

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-[10px] font-semibold uppercase tracking-[0.12em] text-text-muted">Code</h3>
        <button
          type="button"
          onClick={() => setExpanded(true)}
          title="Expand editor"
          className="flex h-6 w-6 items-center justify-center rounded-full text-text-muted transition hover:bg-surface-200 hover:text-text-primary"
        >
          <svg className="h-3 w-3" viewBox="0 0 12 12" fill="none">
            <path d="M4.5 1.5H1.5v3M7.5 10.5h3v-3M1.5 7.5v3h3M10.5 4.5v-3h-3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </div>
      <div className="rounded-[var(--radius-lg)] border border-border-default bg-surface-0/50 p-3">
        <div className="overflow-hidden rounded-[var(--radius-md)] border border-border-default">
          <Editor
            height="280px"
            language={monacoLang}
            theme="vs-dark"
            value={node.code ?? ''}
            onChange={(v) => onChange({ ...node, code: v ?? '' })}
            options={{
              minimap: { enabled: false },
              fontSize: 12,
              lineNumbers: 'off',
              scrollBeyondLastLine: false,
              padding: { top: 10, bottom: 10 },
              fontFamily: '"Source Code Pro", "SF Mono", "Fira Code", monospace',
            }}
          />
        </div>
      </div>

      {expanded && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center p-6">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setExpanded(false)} />
          <div className="relative flex h-[min(90vh,900px)] w-full max-w-6xl flex-col overflow-hidden rounded-[var(--radius-2xl)] border border-border-default bg-surface-100 shadow-[var(--shadow-lg)]">
            <header className="flex items-center justify-between gap-3 border-b border-border-default bg-surface-100/70 px-5 py-3 backdrop-blur-md">
              <div className="flex items-center gap-2">
                <span className="rounded-full bg-brand-tint px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.1em] text-brand">
                  {node.lang}
                </span>
                <span className="text-[13px] font-semibold text-text-primary">{node.label || 'Script'}</span>
                <span className="text-[11px] text-text-muted">· {monacoLang}</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="hidden md:inline text-[10px] text-text-muted">Esc to close</span>
                <button
                  type="button"
                  onClick={() => setExpanded(false)}
                  className="rounded-full bg-brand px-3 py-1 text-[11px] font-semibold text-white transition hover:bg-brand-dark"
                >
                  Done
                </button>
                <button
                  type="button"
                  onClick={() => setExpanded(false)}
                  aria-label="Close"
                  className="flex h-7 w-7 items-center justify-center rounded-full text-text-muted transition hover:bg-surface-200 hover:text-text-primary"
                >
                  <svg className="h-3.5 w-3.5" viewBox="0 0 14 14" fill="none">
                    <path d="M3 3l8 8M11 3l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                  </svg>
                </button>
              </div>
            </header>
            <div className="flex-1 bg-surface-0">
              <Editor
                height="100%"
                language={monacoLang}
                theme="vs-dark"
                value={node.code ?? ''}
                onChange={(v) => onChange({ ...node, code: v ?? '' })}
                options={{
                  minimap: { enabled: true },
                  fontSize: 14,
                  lineNumbers: 'on',
                  scrollBeyondLastLine: false,
                  padding: { top: 14, bottom: 14 },
                  fontFamily: '"Source Code Pro", "SF Mono", "Fira Code", monospace',
                }}
              />
            </div>
          </div>
        </div>
      )}
    </section>
  );
};

const AgentSection: FC<{ node: AgentNode; onChange: (n: AgentNode) => void; profiles: Array<{ id: string; name: string }> }> = ({ node, onChange, profiles }) => (
  <>
    <Section title="Agent">
      <Field label="Profile">
        <Select
          value={node.agentProfileId}
          onChange={(v) => onChange({ ...node, agentProfileId: v })}
          options={[{ v: '', label: '— select —' }, ...profiles.map((p) => ({ v: p.id, label: p.name }))]}
        />
      </Field>
    </Section>
    <Section title="Prompt template">
      <Field label="Template" hint="{input} is the concatenated parent stdout · {repo} is the repo path">
        <textarea
          value={node.promptTemplate}
          onChange={(e) => onChange({ ...node, promptTemplate: e.target.value })}
          placeholder="Analyze the following input and summarize key points:&#10;&#10;{input}"
          className="h-40 w-full resize-none rounded-[var(--radius-md)] border border-border-default bg-surface-200 px-2.5 py-2 text-[12px] font-mono text-text-primary placeholder:text-text-muted transition focus:border-border-focus focus:outline-none focus:shadow-[0_0_0_3px_var(--color-brand-glow)]"
        />
      </Field>
    </Section>
  </>
);
