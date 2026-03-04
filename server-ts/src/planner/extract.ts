// ---------------------------------------------------------------------------
// JSON extraction helpers — pull structured JSON from raw agent output
// ---------------------------------------------------------------------------

/**
 * Attempts to parse JSON from raw agent output using multiple strategies:
 * direct parse, fenced code block extraction, and brace-matching.
 */
export function extractJsonPayload(raw: string): any {
  const trimmed = raw.trim();
  if (!trimmed) {
    throw new Error('agent output is empty');
  }

  // Try direct parse
  try {
    return JSON.parse(trimmed);
  } catch {
    // continue
  }

  // Try fenced JSON
  const fenced = extractFencedJson(trimmed);
  if (fenced !== null) {
    try {
      return JSON.parse(fenced);
    } catch {
      // continue
    }
  }

  // Try extracting first { ... last }
  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  if (start !== -1 && end !== -1 && end > start) {
    const candidate = trimmed.substring(start, end + 1);
    try {
      return JSON.parse(candidate);
    } catch {
      // continue
    }
  }

  throw new Error('failed to parse agent output as strict JSON');
}

/**
 * Extracts text content from the first fenced code block (``` ... ```)
 * found in the input. Returns null if no fenced block is present.
 */
export function extractFencedJson(text: string): string | null {
  let inFence = false;
  const lines: string[] = [];

  for (const rawLine of text.split('\n')) {
    const line = rawLine.trimEnd();
    if (line.trimStart().startsWith('```')) {
      if (!inFence) {
        inFence = true;
        continue;
      }
      break;
    }
    if (inFence) {
      lines.push(line);
    }
  }

  if (lines.length === 0) {
    return null;
  }
  return lines.join('\n');
}
