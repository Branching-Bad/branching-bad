// ---------------------------------------------------------------------------
// Provider utilities — shared helpers for parsing agent output, etc.
// ---------------------------------------------------------------------------

/**
 * Parse a JSON object from agent CLI output, which may contain markdown
 * code blocks or extra text.
 */
export function parseJsonFromAgent<T>(text: string): T {
  const trimmed = text.trim();

  // Try direct parse first
  try {
    return JSON.parse(trimmed) as T;
  } catch {
    // fall through
  }

  // Try to extract first complete JSON object
  const start = trimmed.indexOf('{');
  if (start >= 0) {
    let depth = 0;
    let end = start;
    for (let i = start; i < trimmed.length; i++) {
      if (trimmed[i] === '{') {
        depth++;
      } else if (trimmed[i] === '}') {
        depth--;
        if (depth === 0) {
          end = i + 1;
          break;
        }
      }
    }
    if (end > start) {
      try {
        return JSON.parse(trimmed.slice(start, end)) as T;
      } catch {
        // fall through
      }
    }
  }

  throw new Error('No valid JSON found in agent response');
}

/**
 * Truncate a string to a maximum character length.
 */
export function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max);
}

/**
 * Build a query string from key-value pairs for URL construction.
 */
export function buildQueryString(params: Record<string, string>): string {
  const entries = Object.entries(params).filter(
    ([, v]) => v !== undefined && v !== '',
  );
  if (entries.length === 0) return '';
  return '?' + entries.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&');
}

/**
 * Safely parse JSON with a fallback.
 */
export function safeJsonParse<T>(json: string, fallback: T): T {
  try {
    return JSON.parse(json) as T;
  } catch {
    return fallback;
  }
}
