import { type FC, type ReactNode } from 'react';
import Editor from '@monaco-editor/react';
import type { GraphNode, ScriptNode, AgentNode } from '../types/workflow';

interface Props {
  node: GraphNode;
  agentProfiles: Array<{ id: string; name: string }>;
  onChange: (next: GraphNode) => void;
  onDelete: () => void;
  onClose: () => void;
}

const KIND_LABEL: Record<GraphNode['kind'], string> = {
  script: 'Script',
  agent: 'Agent',
  merge: 'Merge',
};

export const WorkflowNodeEditor: FC<Props> = ({ node, agentProfiles, onChange, onDelete, onClose }) => (
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
            Configure input order on each incoming edge.
          </p>
        </Section>
      )}
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
      <Section title="Code">
        <div className="overflow-hidden rounded-[var(--radius-md)] border border-border-default">
          <Editor
            height="280px"
            language={node.lang === 'python' ? 'python' : node.lang === 'typescript' ? 'typescript' : 'shell'}
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
      </Section>
    )}
  </>
);

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
