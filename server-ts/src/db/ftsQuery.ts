/**
 * Sanitize a free-form text into a SQLite FTS5 MATCH-safe query string.
 *
 * Strips characters that break FTS5 MATCH syntax (quotes, operators, punctuation)
 * while preserving letters and digits from ALL scripts via Unicode property escapes.
 * Using `\w` here would drop non-ASCII letters (e.g. Turkish `ğ ş ç ö ü ı İ`,
 * Greek, Cyrillic), shredding words into broken tokens that no longer match
 * what FTS5's `unicode61` tokenizer indexed.
 */
export function sanitizeFtsQuery(text: string): string {
  return (text ?? '')
    .replace(/[^\p{L}\p{N}\s_]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Convert sanitized text into an FTS5 MATCH expression with OR semantics.
 *
 * FTS5's implicit operator between bare tokens is AND — so `foo bar baz` only
 * matches documents containing ALL three. For prompt-style retrieval that is
 * way too strict: a single stopword (Turkish "ve", "ile", English "the", "and")
 * not present in a memory would zero-out the whole query. OR-joining lets BM25
 * surface documents sharing *any* meaningful token and still rank multi-hits
 * higher naturally.
 *
 * Tokens are lowercased and double-quoted so reserved FTS5 operators
 * (AND/OR/NOT/NEAR) can never be interpreted as syntax.
 */
export function buildFtsMatchExpr(sanitized: string): string {
  if (!sanitized) return '';
  const tokens = sanitized
    .split(/\s+/)
    .filter(Boolean)
    .map((t) => t.toLowerCase().replace(/"/g, '""'));
  if (tokens.length === 0) return '';
  return tokens.map((t) => `"${t}"`).join(' OR ');
}
