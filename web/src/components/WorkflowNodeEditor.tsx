import { type FC } from 'react';
import Editor from '@monaco-editor/react';
import type { GraphNode, ScriptNode, AgentNode } from '../types/workflow';

interface Props {
  node: GraphNode;
  agentProfiles: Array<{ id: string; name: string }>;
  onChange: (next: GraphNode) => void;
  onDelete: () => void;
}

export const WorkflowNodeEditor: FC<Props> = ({ node, agentProfiles, onChange, onDelete }) => (
  <aside className="w-96 border-l border-border-default bg-surface-100 p-3 flex flex-col gap-3 overflow-auto">
    <label className="text-xs text-text-secondary flex flex-col gap-1">
      Label
      <input
        className="w-full bg-surface-200 px-2 py-1 rounded text-sm text-text-primary"
        value={node.label}
        onChange={(e) => onChange({ ...node, label: e.target.value })}
      />
    </label>

    <label className="text-xs text-text-secondary flex flex-col gap-1">
      On failure
      <select
        className="w-full bg-surface-200 px-2 py-1 rounded text-sm text-text-primary"
        value={node.onFail}
        onChange={(e) => onChange({ ...node, onFail: e.target.value as GraphNode['onFail'] })}
      >
        <option value="halt-subtree">Halt subtree</option>
        <option value="halt-all">Halt all branches</option>
      </select>
    </label>

    {node.kind === 'script' && <ScriptFields node={node} onChange={(n) => onChange(n)} />}
    {node.kind === 'agent' && <AgentFields node={node} onChange={(n) => onChange(n)} profiles={agentProfiles} />}
    {node.kind === 'merge' && (
      <div className="text-xs text-text-muted">
        Merge node — concatenates incoming parents in their input order and emits to downstream.
      </div>
    )}

    <button className="mt-auto bg-red-700 hover:bg-red-600 text-white px-2 py-1 rounded text-sm" onClick={onDelete}>
      Delete node
    </button>
  </aside>
);

const ScriptFields: FC<{ node: ScriptNode; onChange: (n: ScriptNode) => void }> = ({ node, onChange }) => (
  <div className="flex flex-col gap-2">
    <label className="text-xs text-text-secondary flex flex-col gap-1">
      Language
      <select
        className="w-full bg-surface-200 px-2 py-1 rounded text-sm text-text-primary"
        value={node.lang}
        onChange={(e) => onChange({ ...node, lang: e.target.value as ScriptNode['lang'] })}
      >
        <option value="python">Python</option>
        <option value="typescript">TypeScript</option>
        <option value="custom">Custom</option>
      </select>
    </label>

    <label className="text-xs text-text-secondary flex flex-col gap-1">
      Source
      <select
        className="w-full bg-surface-200 px-2 py-1 rounded text-sm text-text-primary"
        value={node.source}
        onChange={(e) => onChange({ ...node, source: e.target.value as ScriptNode['source'] })}
      >
        <option value="inline">Inline code</option>
        <option value="file">File path (repo-relative)</option>
      </select>
    </label>

    {node.lang === 'custom' && (
      <label className="text-xs text-text-secondary flex flex-col gap-1">
        Run command (use {'{file}'})
        <input
          className="w-full bg-surface-200 px-2 py-1 rounded text-sm font-mono text-text-primary"
          placeholder="dotnet script {file}"
          value={node.runCommand ?? ''}
          onChange={(e) => onChange({ ...node, runCommand: e.target.value })}
        />
      </label>
    )}

    {node.source === 'file' ? (
      <label className="text-xs text-text-secondary flex flex-col gap-1">
        File path (repo-relative)
        <input
          className="w-full bg-surface-200 px-2 py-1 rounded text-sm font-mono text-text-primary"
          value={node.filePath ?? ''}
          onChange={(e) => onChange({ ...node, filePath: e.target.value })}
        />
      </label>
    ) : (
      <div className="h-64 border border-border-default rounded overflow-hidden">
        <Editor
          language={node.lang === 'python' ? 'python' : node.lang === 'typescript' ? 'typescript' : 'shell'}
          theme="vs-dark"
          value={node.code ?? ''}
          onChange={(v) => onChange({ ...node, code: v ?? '' })}
          options={{ minimap: { enabled: false }, fontSize: 12 }}
        />
      </div>
    )}
  </div>
);

const AgentFields: FC<{ node: AgentNode; onChange: (n: AgentNode) => void; profiles: Array<{ id: string; name: string }> }> = ({ node, onChange, profiles }) => (
  <div className="flex flex-col gap-2">
    <label className="text-xs text-text-secondary flex flex-col gap-1">
      Agent profile
      <select
        className="w-full bg-surface-200 px-2 py-1 rounded text-sm text-text-primary"
        value={node.agentProfileId}
        onChange={(e) => onChange({ ...node, agentProfileId: e.target.value })}
      >
        <option value="">-- select --</option>
        {profiles.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
      </select>
    </label>
    <label className="text-xs text-text-secondary flex flex-col gap-1">
      Prompt template (use {'{input}'} and {'{repo}'})
      <textarea
        className="w-full h-40 bg-surface-200 px-2 py-1 rounded text-sm font-mono text-text-primary"
        value={node.promptTemplate}
        onChange={(e) => onChange({ ...node, promptTemplate: e.target.value })}
      />
    </label>
  </div>
);
