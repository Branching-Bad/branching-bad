import type { LogMsg } from './types.js';
import { truncatePreview } from './shell.js';

// ---------------------------------------------------------------------------
// parseCodexExecJson
// ---------------------------------------------------------------------------

/** Parse a single line from `codex exec --json`. */
export function parseCodexExecJson(line: string): LogMsg | undefined {
  let v: any;
  try {
    v = JSON.parse(line);
  } catch {
    return undefined;
  }

  const msgType = v?.type;
  if (typeof msgType !== 'string') {
    return undefined;
  }

  switch (msgType) {
    case 'item.started':
      return parseCodexItemStarted(v);
    case 'item.completed':
      return parseCodexItemCompleted(v);
    case 'error': {
      const message = v.error ?? v.message ?? '';
      return message ? { type: 'stderr', data: message } : undefined;
    }
    default:
      return undefined;
  }
}

function parseCodexItemStarted(v: any): LogMsg | undefined {
  const item = v.item;
  if (!item || item.type !== 'command_execution') return undefined;

  const command = item.command ?? 'command';
  return {
    type: 'tool_use',
    data: JSON.stringify({ tool: 'shell', input: truncatePreview(command, 500) }),
  };
}

function parseCodexItemCompleted(v: any): LogMsg | undefined {
  const item = v.item;
  if (!item) return undefined;

  if (item.type === 'reasoning') {
    const text = item.text ?? '';
    return text ? { type: 'thinking', data: text } : undefined;
  }

  if (item.type === 'agent_message') {
    const text = item.text ?? '';
    return text ? { type: 'agent_text', data: text } : undefined;
  }

  if (item.type === 'command_execution') {
    const command = item.command ?? 'shell';
    const output = item.aggregated_output ?? '';
    const exitCode = item.exit_code ?? 'unknown';
    const preview = output
      ? `exitCode=${exitCode}\n${output}`
      : `exitCode=${exitCode}`;
    return {
      type: 'tool_result',
      data: JSON.stringify({ tool: command, output: truncatePreview(preview, 500) }),
    };
  }

  return undefined;
}
