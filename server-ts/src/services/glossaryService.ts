import type { Db } from '../db/index.js';
import { sanitizeFtsQuery, buildFtsMatchExpr } from '../db/ftsQuery.js';

/**
 * Search glossary for terms relevant to the given text and format as a prompt section.
 */
export function buildGlossarySection(db: Db, repoId: string, text: string): string {
  const matchExpr = buildFtsMatchExpr(sanitizeFtsQuery(text));
  if (!matchExpr) return '';

  let terms;
  try {
    terms = db.searchGlossaryTerms(repoId, matchExpr, 5);
  } catch {
    return '';
  }

  if (terms.length === 0) return '';

  const items = terms.map((t) => `- **${t.term}**: ${t.description}`);
  return `\nRelated glossary entries (BM25 search results — some may not be relevant):
${items.join('\n')}\n`;
}
