// ---------------------------------------------------------------------------
// Line-level parsing helpers for Claude/agent streaming output
// ---------------------------------------------------------------------------

import type { LogMsg } from '../msgStore.js';

import { truncateProgressLine } from './stream-extract.js';
import {
  parseAssistantContent,
  parseContentBlockDelta,
  parseContentBlockStart,
  parseResultBlock,
  parseToolResult,
} from './stream-sub-parsers.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ClaudeStreamLineResult {
  messages: LogMsg[];
  finalOutput: string | null;
  sessionId: string | null;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function parseClaudeStreamLine(line: string): ClaudeStreamLineResult {
  let v: any;
  try {
    v = JSON.parse(line);
  } catch {
    return {
      messages: line.trim() ? [{ type: 'stdout', data: truncateProgressLine(line) }] : [],
      finalOutput: null,
      sessionId: null,
    };
  }

  const msgType = v?.type;
  if (typeof msgType !== 'string') {
    return {
      messages: line.trim() ? [{ type: 'stdout', data: truncateProgressLine(line) }] : [],
      finalOutput: null,
      sessionId: null,
    };
  }

  const messages: LogMsg[] = [];
  let finalOutput: string | null = null;
  let sessionId: string | null = null;

  switch (msgType) {
    case 'assistant': {
      parseAssistantContent(v?.message?.content, messages);
      break;
    }

    case 'content_block_delta': {
      parseContentBlockDelta(v?.delta, messages);
      break;
    }

    case 'content_block_start': {
      parseContentBlockStart(v?.content_block, messages);
      break;
    }

    case 'tool_result': {
      parseToolResult(v, messages);
      break;
    }

    case 'result': {
      const result = parseResultBlock(v);
      finalOutput = result.finalOutput;
      sessionId = result.sessionId;
      break;
    }

    // Skip noisy lifecycle/metadata events
    case 'system':
    case 'message_start':
    case 'message_delta':
    case 'message_stop':
    case 'ping':
    case 'content_block_stop':
    case 'rate_limit_event':
    case 'error_event':
    case 'usage_event':
      break;

    default:
      if (line.trim()) {
        messages.push({ type: 'stdout', data: truncateProgressLine(line) });
      }
      break;
  }

  // Also extract session_id from any event that includes it
  if (sessionId === null && typeof v?.session_id === 'string') {
    sessionId = v.session_id;
  }

  return { messages, finalOutput, sessionId };
}
