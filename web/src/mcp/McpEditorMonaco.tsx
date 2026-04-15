import { type FC, useEffect } from 'react';
import Editor, { loader } from '@monaco-editor/react';
import type { McpCatalog } from './types';

interface Props {
  catalog: McpCatalog;
  catalogId: string;
  value: string;
  onChange: (v: string) => void;
  height?: string;
}

let schemasRegistered = false;

export const McpEditorMonaco: FC<Props> = ({ catalog, catalogId, value, onChange, height = '320px' }) => {
  useEffect(() => {
    if (schemasRegistered) return;
    loader.init().then((monaco) => {
      const schemas = Object.entries(catalog.entries).map(([id, entry]) => ({
        uri: `inmemory://mcp-${id}.schema.json`,
        fileMatch: [`mcp-config-${id}.json`],
        schema: entry.envSchema,
      }));
      monaco.languages.json.jsonDefaults.setDiagnosticsOptions({
        validate: true,
        allowComments: false,
        schemas,
      });
      schemasRegistered = true;
    });
  }, [catalog]);

  return (
    <div className="overflow-hidden rounded-[var(--radius-md)] border border-border-default">
      <Editor
        height={height}
        language="json"
        theme="vs-dark"
        path={`mcp-config-${catalogId}.json`}
        value={value}
        onChange={(v) => onChange(v ?? '')}
        options={{
          minimap: { enabled: false },
          fontSize: 12,
          lineNumbers: 'on',
          scrollBeyondLastLine: false,
          padding: { top: 10, bottom: 10 },
          fontFamily: '"Source Code Pro", "SF Mono", "Fira Code", monospace',
        }}
      />
    </div>
  );
};
