// Re-export shim — the original stream.ts has been split into:
//   stream-parsers.ts  (line-level parsing)
//   stream-extract.ts  (text extraction & truncation helpers)

export { parseClaudeStreamLine } from './stream-parsers.js';
export type { ClaudeStreamLineResult } from './stream-parsers.js';
export { extractTextFromClaudeStream, truncateProgressLine } from './stream-extract.js';
