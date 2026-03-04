// ---------------------------------------------------------------------------
// Sub-parsers for individual Claude stream event types
// ---------------------------------------------------------------------------

import type { LogMsg } from '../msgStore.js';

import { truncateProgressLine } from './stream-extract.js';

// ---------------------------------------------------------------------------
// Tool input formatting
// ---------------------------------------------------------------------------

export function formatToolInput(input: any): string {
  if (!input || typeof input !== 'object') return '';

  const filePath = input.file_path ?? input.path ?? input.filename;
  if (filePath) {
    const extra: string[] = [];
    if (input.command) extra.push(`command: ${input.command}`);
    if (input.pattern) extra.push(`pattern: ${input.pattern}`);
    if (input.old_string) extra.push('(edit)');
    if (input.content) extra.push('(write)');
    return extra.length > 0 ? `${filePath} ${extra.join(' ')}` : String(filePath);
  }

  if (input.command) return truncateProgressLine(input.command);
  if (input.pattern) return `pattern: ${input.pattern}`;
  if (input.query) return truncateProgressLine(String(input.query));
  if (input.url) return String(input.url);

  const json = JSON.stringify(input);
  return json.length > 200 ? json.slice(0, 200) + '\u2026' : json;
}

// ---------------------------------------------------------------------------
// Assistant content blocks
// ---------------------------------------------------------------------------

export function parseAssistantContent(content: any, messages: LogMsg[]): void {
  if (!Array.isArray(content)) return;

  for (const block of content) {
    const blockType = block?.type ?? '';
    if (blockType === 'thinking') {
      const text = block?.thinking;
      if (typeof text === 'string' && text) {
        messages.push({ type: 'thinking', data: text });
      }
    } else if (blockType === 'text') {
      const text = block?.text;
      if (typeof text === 'string' && text) {
        messages.push({ type: 'agent_text', data: text });
      }
    } else if (blockType === 'tool_use') {
      const tool = block?.name ?? 'unknown';
      messages.push({
        type: 'tool_use',
        data: JSON.stringify({ tool, input_preview: formatToolInput(block?.input) }),
      });
    }
  }
}

// ---------------------------------------------------------------------------
// Content block delta
// ---------------------------------------------------------------------------

export function parseContentBlockDelta(delta: any, messages: LogMsg[]): void {
  if (!delta) return;

  const deltaType = delta?.type ?? '';
  if (deltaType === 'thinking_delta') {
    const text = delta?.thinking;
    if (typeof text === 'string' && text) {
      messages.push({ type: 'thinking', data: text });
    }
  } else if (deltaType === 'text_delta') {
    const text = delta?.text;
    if (typeof text === 'string' && text) {
      messages.push({ type: 'agent_text', data: text });
    }
  }
}

// ---------------------------------------------------------------------------
// Content block start
// ---------------------------------------------------------------------------

export function parseContentBlockStart(contentBlock: any, messages: LogMsg[]): void {
  if (!contentBlock) return;

  const blockType = contentBlock?.type ?? '';
  if (blockType === 'tool_use') {
    const tool = contentBlock?.name ?? 'unknown';
    messages.push({
      type: 'tool_use',
      data: JSON.stringify({ tool, input_preview: formatToolInput(contentBlock?.input) }),
    });
  } else if (blockType === 'thinking') {
    const text = contentBlock?.thinking;
    if (typeof text === 'string' && text) {
      messages.push({ type: 'thinking', data: text });
    }
  } else if (blockType === 'text') {
    const text = contentBlock?.text;
    if (typeof text === 'string' && text) {
      messages.push({ type: 'agent_text', data: text });
    }
  }
}

// ---------------------------------------------------------------------------
// Tool result
// ---------------------------------------------------------------------------

export function parseToolResult(v: any, messages: LogMsg[]): void {
  const tool = v?.tool_name ?? v?.name ?? 'tool';
  const outputValue = v?.output ?? v?.content;
  let outputStr = '';
  if (outputValue) {
    const raw = typeof outputValue === 'string' ? outputValue : JSON.stringify(outputValue);
    const lines = raw.split('\n').filter((l: string) => l.trim());
    if (lines.length > 6) {
      outputStr = lines.slice(0, 4).join('\n') + `\n… (${lines.length - 4} more lines)`;
    } else {
      outputStr = lines.join('\n');
    }
    outputStr = truncateProgressLine(outputStr);
  }
  messages.push({
    type: 'tool_result',
    data: JSON.stringify({ tool, output_preview: outputStr }),
  });
}

// ---------------------------------------------------------------------------
// Result block (final output + session ID)
// ---------------------------------------------------------------------------

export function parseResultBlock(v: any): { finalOutput: string | null; sessionId: string | null } {
  let finalOutput: string | null = null;
  let sessionId: string | null = null;

  const output = v?.result;
  if (output != null) {
    let text: string;
    if (typeof output === 'string') {
      text = output;
    } else if (Array.isArray(output)) {
      text = output
        .filter((block: any) => block?.type === 'text' && typeof block?.text === 'string')
        .map((block: any) => block.text)
        .join('\n');
    } else {
      text = JSON.stringify(output);
    }
    if (text.trim()) {
      finalOutput = text;
    }
  }
  if (typeof v?.session_id === 'string') {
    sessionId = v.session_id;
  }

  return { finalOutput, sessionId };
}
