import type { Db } from '../db/index.js';

/**
 * Search glossary for terms relevant to the given text and format as a prompt section.
 */
export function buildGlossarySection(db: Db, repoId: string, text: string): string {
  const sanitized = text.replace(/[^\w\s]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!sanitized) return '';

  let terms;
  try {
    terms = db.searchGlossaryTerms(repoId, sanitized, 10);
  } catch {
    return '';
  }

  if (terms.length === 0) return '';

  const items = terms.map((t) => `- **${t.term}**: ${t.description}`);
  return `\nGlossary (domain terms relevant to this task):\n${items.join('\n')}\n`;
}
