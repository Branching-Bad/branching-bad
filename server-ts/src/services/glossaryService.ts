import type { Db } from '../db/index.js';

/**
 * Search glossary for terms relevant to the given text and format as a prompt section.
 */
export function buildGlossarySection(db: Db, repoId: string, text: string): string {
  const sanitized = text.replace(/[^\w\s]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!sanitized) return '';

  let terms;
  try {
    terms = db.searchGlossaryTerms(repoId, sanitized, 5);
  } catch {
    return '';
  }

  if (terms.length === 0) return '';

  const items = terms.map((t) => `- **${t.term}**: ${t.description}`);
  return `\nRelated glossary entries (BM25 search results — some may not be relevant):
${items.join('\n')}\n`;
}
