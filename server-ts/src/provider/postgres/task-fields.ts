// ---------------------------------------------------------------------------
// PostgreSQL Provider — itemToTaskFields mapping
// ---------------------------------------------------------------------------

import type { ProviderItem, TaskFieldsFromItem } from '../index.js';

export function pgItemToTaskFields(item: ProviderItem): TaskFieldsFromItem {
  const data = item.data;
  const category = String(data.category ?? 'unknown');
  const severity = String(data.severity ?? 'medium');
  const recommendation = String(data.recommendation ?? '');

  const description = buildDescription(category, severity, recommendation, data);

  const prefixMap: Record<string, string> = {
    slow_query: '[PG-SLOW]',
    n_plus_one: '[PG-N+1]',
    missing_index: '[PG-INDEX]',
    unused_index: '[PG-UNUSED-IDX]',
    vacuum_needed: '[PG-VACUUM]',
  };
  const prefix = prefixMap[category] ?? '[PG]';

  return {
    title: `${prefix} ${item.title}`,
    description,
    requirePlan: true,
    autoStart: false,
  };
}

function buildDescription(
  category: string,
  severity: string,
  recommendation: string,
  data: Record<string, any>,
): string {
  switch (category) {
    case 'slow_query': {
      const query = String(data.query ?? 'N/A');
      const meanMs = Number(data.mean_ms ?? 0);
      const calls = Number(data.calls ?? 0);
      const totalMs = Number(data.total_ms ?? 0);
      return (
        `## PostgreSQL Performance: Slow Query\n\n` +
        `**Severity:** ${severity}\n` +
        `**Mean execution time:** ${meanMs.toFixed(1)} ms\n` +
        `**Total calls:** ${calls}\n` +
        `**Total time:** ${totalMs.toFixed(0)} ms\n\n` +
        `### Query\n\`\`\`sql\n${query}\n\`\`\`\n\n` +
        `### Recommendation\n${recommendation}`
      );
    }
    case 'n_plus_one': {
      const query = String(data.query ?? 'N/A');
      const calls = Number(data.calls ?? 0);
      const meanMs = Number(data.mean_ms ?? 0);
      return (
        `## PostgreSQL Performance: N+1 Query Pattern\n\n` +
        `**Severity:** ${severity}\n` +
        `**Call count:** ${calls}\n` +
        `**Mean execution time:** ${meanMs.toFixed(1)} ms\n\n` +
        `### Query\n\`\`\`sql\n${query}\n\`\`\`\n\n` +
        `### Recommendation\n${recommendation}`
      );
    }
    case 'missing_index': {
      const table = String(data.table_name ?? 'N/A');
      const schema = String(data.schema_name ?? 'public');
      const seqPct = Number(data.seq_scan_pct ?? 0);
      const rowCount = Number(data.row_count ?? 0);
      return (
        `## PostgreSQL Performance: Missing Index\n\n` +
        `**Severity:** ${severity}\n` +
        `**Table:** ${schema}.${table}\n` +
        `**Row count:** ${rowCount}\n` +
        `**Sequential scan ratio:** ${seqPct}%\n\n` +
        `### Recommendation\n${recommendation}`
      );
    }
    case 'unused_index': {
      const index = String(data.index_name ?? 'N/A');
      const schema = String(data.schema_name ?? 'public');
      const sizeMb = Number(data.index_size_mb ?? 0);
      return (
        `## PostgreSQL Performance: Unused Index\n\n` +
        `**Severity:** ${severity}\n` +
        `**Index:** ${schema}.${index}\n` +
        `**Size:** ${sizeMb.toFixed(1)} MB\n\n` +
        `### Recommendation\n${recommendation}`
      );
    }
    case 'vacuum_needed': {
      const table = String(data.table_name ?? 'N/A');
      const schema = String(data.schema_name ?? 'public');
      const deadPct = Number(data.dead_pct ?? 0);
      const dead = Number(data.n_dead_tup ?? 0);
      return (
        `## PostgreSQL Performance: Vacuum Needed\n\n` +
        `**Severity:** ${severity}\n` +
        `**Table:** ${schema}.${table}\n` +
        `**Dead tuple ratio:** ${deadPct}%\n` +
        `**Dead tuples:** ${dead}\n\n` +
        `### Recommendation\n${recommendation}`
      );
    }
    default:
      return (
        `## PostgreSQL Performance Issue\n\n` +
        `**Severity:** ${severity}\n\n` +
        `### Recommendation\n${recommendation}`
      );
  }
}
