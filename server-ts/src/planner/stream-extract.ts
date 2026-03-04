// ---------------------------------------------------------------------------
// Text extraction and progress helpers for Claude/agent output streams
// ---------------------------------------------------------------------------

/**
 * Truncate a progress line to avoid oversized log entries.
 */
export function truncateProgressLine(input: string): string {
  const MAX_CHARS = 1200;
  if (input.length <= MAX_CHARS) {
    return input;
  }
  return input.substring(0, MAX_CHARS) + '\u2026';
}

/**
 * Walk a raw newline-delimited Claude stream and extract all text content
 * from `assistant` and `result` events.
 */
export function extractTextFromClaudeStream(raw: string): string {
  const textParts: string[] = [];

  for (const line of raw.split('\n')) {
    let v: any;
    try {
      v = JSON.parse(line);
    } catch {
      continue;
    }

    const msgType = v?.type;
    if (typeof msgType !== 'string') {
      continue;
    }

    if (msgType === 'assistant') {
      const content = v?.message?.content;
      if (Array.isArray(content)) {
        for (const block of content) {
          if (block?.type === 'text' && typeof block?.text === 'string') {
            textParts.push(block.text);
          }
        }
      }
    } else if (msgType === 'result') {
      const output = v?.result;
      if (typeof output === 'string') {
        textParts.push(output);
      } else if (Array.isArray(output)) {
        for (const block of output) {
          if (block?.type === 'text' && typeof block?.text === 'string') {
            textParts.push(block.text);
          }
        }
      }
    }
  }

  return textParts.join('\n');
}
