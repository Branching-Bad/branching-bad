import type { LogMsg } from './types.js';
import { truncatePreview } from './shell.js';

// ---------------------------------------------------------------------------
// Stream output formatting helpers
// ---------------------------------------------------------------------------

/** Format tool input for user-friendly display instead of raw JSON. */
export function formatToolInputPreview(input: any): string {
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

  if (input.command) return truncatePreview(input.command, 200);
  if (input.pattern) return `pattern: ${input.pattern}`;
  if (input.query) return truncatePreview(String(input.query), 200);
  if (input.url) return String(input.url);

  const json = JSON.stringify(input);
  return json.length > 200 ? json.slice(0, 200) + '\u2026' : json;
}

/** Compact tool output: show first few lines + count of remaining. */
export function compactToolOutput(raw: string): string {
  const lines = raw.split('\n').filter((l) => l.trim());
  let result: string;
  if (lines.length > 6) {
    result = lines.slice(0, 4).join('\n') + `\n\u2026 (${lines.length - 4} more lines)`;
  } else {
    result = lines.join('\n');
  }
  return truncatePreview(result, 600);
}

// ---------------------------------------------------------------------------
// parseClaudeStreamJson
// ---------------------------------------------------------------------------

/**
 * Parse a single line of Claude Code `--output-format stream-json`.
 * Returns a structured log message if recognized, plus an optional session ID.
 */
export function parseClaudeStreamJson(
  line: string,
): { msg: LogMsg; sessionId?: string } | undefined {
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
    case 'assistant':
      return parseAssistantMessage(v);

    case 'content_block_delta':
      return parseContentBlockDelta(v);

    case 'content_block_start':
      return parseContentBlockStart(v);

    case 'tool_result':
      return parseToolResult(v);

    case 'result':
      return parseResultMessage(v);

    // Skip lifecycle/metadata events
    case 'system':
    case 'message_start':
    case 'message_delta':
    case 'message_stop':
    case 'ping':
    case 'content_block_stop':
    case 'rate_limit_event':
    case 'error_event':
    case 'usage_event':
      return undefined;

    default:
      return undefined;
  }
}

// ---------------------------------------------------------------------------
// Claude stream sub-parsers
// ---------------------------------------------------------------------------

function parseAssistantMessage(v: any): { msg: LogMsg } | undefined {
  // Full message with content blocks
  if (v.message?.content && Array.isArray(v.message.content)) {
    for (const block of v.message.content) {
      const result = parseContentBlock(block);
      if (result) return result;
    }
  }

  // Content delta (partial streaming)
  if (v.content_block) {
    return parseContentBlock(v.content_block);
  }

  return undefined;
}

function parseContentBlock(block: any): { msg: LogMsg } | undefined {
  const blockType = block?.type ?? '';

  if (blockType === 'thinking') {
    const text = block.thinking ?? '';
    if (text) return { msg: { type: 'thinking', data: text } };
  } else if (blockType === 'text') {
    const text = block.text ?? '';
    if (text) return { msg: { type: 'agent_text', data: text } };
  } else if (blockType === 'tool_use') {
    const tool = block.name ?? 'unknown';
    const inputPreview = formatToolInputPreview(block.input);
    const data = inputPreview
      ? JSON.stringify({ tool, input_preview: inputPreview })
      : JSON.stringify({ tool, input: '' });
    return { msg: { type: 'tool_use', data } };
  }

  return undefined;
}

function parseContentBlockDelta(v: any): { msg: LogMsg } | undefined {
  const delta = v.delta;
  if (!delta) return undefined;

  const deltaType = delta.type ?? '';
  if (deltaType === 'thinking_delta') {
    const text = delta.thinking ?? '';
    if (text) return { msg: { type: 'thinking', data: text } };
  } else if (deltaType === 'text_delta') {
    const text = delta.text ?? '';
    if (text) return { msg: { type: 'agent_text', data: text } };
  }

  return undefined;
}

function parseContentBlockStart(v: any): { msg: LogMsg } | undefined {
  const contentBlock = v.content_block;
  if (!contentBlock) return undefined;

  if (contentBlock.type === 'tool_use') {
    const tool = contentBlock.name ?? 'unknown';
    return {
      msg: { type: 'tool_use', data: JSON.stringify({ tool, input: '' }) },
    };
  }

  return undefined;
}

function parseToolResult(v: any): { msg: LogMsg } | undefined {
  const tool = v.tool_name ?? v.name ?? 'tool';
  const rawOutput = v.output ?? v.content;
  const output = rawOutput
    ? compactToolOutput(typeof rawOutput === 'string' ? rawOutput : JSON.stringify(rawOutput))
    : '';
  return {
    msg: { type: 'tool_result', data: JSON.stringify({ tool, output_preview: output }) },
  };
}

function parseResultMessage(v: any): { msg: LogMsg; sessionId?: string } | undefined {
  const sessionId = typeof v.session_id === 'string' ? v.session_id : undefined;
  if (!sessionId) return undefined;
  return {
    msg: { type: 'agent_text', data: `[session: ${sessionId}]` },
    sessionId,
  };
}

// ---------------------------------------------------------------------------
// parseGeminiStreamJson
// ---------------------------------------------------------------------------

/**
 * Parse a single line of Gemini CLI `--output-format stream-json`.
 * Event types: init, message, tool_use, tool_result, error, result.
 */
export function parseGeminiStreamJson(
  line: string,
): { msg: LogMsg; sessionId?: string } | undefined {
  let v: any;
  try {
    v = JSON.parse(line);
  } catch {
    return undefined;
  }

  const type = v?.type;
  if (typeof type !== 'string') return undefined;

  switch (type) {
    case 'init': {
      const sessionId = typeof v.session_id === 'string' ? v.session_id : undefined;
      if (sessionId) return { msg: { type: 'agent_text', data: '' }, sessionId };
      return undefined;
    }
    case 'message': {
      const role = v.role ?? v.message?.role ?? '';
      const text = v.content ?? v.text ?? v.message?.content ?? '';
      if (role === 'model' || role === 'assistant') {
        if (typeof text === 'string' && text) {
          return { msg: { type: 'agent_text', data: text } };
        }
        // Content may be array of parts
        if (Array.isArray(text)) {
          for (const part of text) {
            if (part?.thought) return { msg: { type: 'thinking', data: part.thought } };
            if (part?.text) return { msg: { type: 'agent_text', data: part.text } };
          }
        }
      }
      return undefined;
    }
    case 'tool_use': {
      const tool = v.tool_name ?? v.name ?? 'tool';
      const inputPreview = v.input ? formatToolInputPreview(v.input) : '';
      return {
        msg: { type: 'tool_use', data: JSON.stringify({ tool, input_preview: inputPreview }) },
      };
    }
    case 'tool_result': {
      return parseToolResult(v);
    }
    case 'result': {
      const sessionId = typeof v.session_id === 'string' ? v.session_id : undefined;
      const text = v.response ?? v.content ?? '';
      const msg: LogMsg = text
        ? { type: 'agent_text', data: typeof text === 'string' ? text : JSON.stringify(text) }
        : { type: 'agent_text', data: '' };
      return { msg, sessionId };
    }
    case 'error': {
      const errMsg = v.message ?? v.error ?? 'Unknown error';
      return { msg: { type: 'stderr', data: String(errMsg) } };
    }
    default:
      return undefined;
  }
}
