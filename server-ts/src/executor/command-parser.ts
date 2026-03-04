// ---------------------------------------------------------------------------
// splitCommand
// ---------------------------------------------------------------------------

/**
 * Platform-aware command string splitting.
 * On Windows: tokenizes with double-quote awareness for paths like
 *   "C:\Program Files\claude\claude.exe" --model sonnet
 * On Unix: shell-like parsing that handles single/double quotes and escapes.
 */
export function splitCommand(cmd: string): string[] {
  if (process.platform === 'win32') {
    const tokens: string[] = [];
    let current = '';
    let inQuote = false;
    for (const ch of cmd) {
      if (ch === '"') {
        inQuote = !inQuote;
      } else if (ch === ' ' && !inQuote) {
        if (current) tokens.push(current);
        current = '';
      } else {
        current += ch;
      }
    }
    if (current) tokens.push(current);
    return tokens;
  }

  const parts: string[] = [];
  let current = '';
  let inSingle = false;
  let inDouble = false;
  let escaped = false;

  for (const ch of cmd) {
    if (escaped) {
      current += ch;
      escaped = false;
      continue;
    }

    if (ch === '\\' && !inSingle) {
      escaped = true;
      continue;
    }

    if (ch === "'" && !inDouble) {
      inSingle = !inSingle;
      continue;
    }

    if (ch === '"' && !inSingle) {
      inDouble = !inDouble;
      continue;
    }

    if ((ch === ' ' || ch === '\t') && !inSingle && !inDouble) {
      if (current.length > 0) {
        parts.push(current);
        current = '';
      }
      continue;
    }

    current += ch;
  }

  if (current.length > 0) {
    parts.push(current);
  }

  if (inSingle || inDouble) {
    throw new Error('invalid shell command: mismatched quotes');
  }

  return parts;
}
