// ---------------------------------------------------------------------------
// PostgreSQL Diagnostics — table-level checks (indexes, vacuum)
// ---------------------------------------------------------------------------

import type { PgFinding } from './models.js';
import { round2 } from './client.js';

export async function findMissingIndexes(client: any, findings: PgFinding[]): Promise<void> {
  const sql = `
    SELECT schemaname, relname,
           seq_scan::bigint, idx_scan::bigint,
           n_live_tup::bigint,
           (CASE WHEN (seq_scan + idx_scan) > 0
                 THEN (100.0 * seq_scan / (seq_scan + idx_scan))
                 ELSE 0 END)::float8 AS seq_scan_pct
    FROM pg_stat_user_tables
    WHERE n_live_tup > 10000
      AND (seq_scan + idx_scan) > 0
      AND CASE WHEN (seq_scan + idx_scan) > 0
               THEN (100.0 * seq_scan / (seq_scan + idx_scan))
               ELSE 0 END > 80
    ORDER BY seq_scan_pct DESC, n_live_tup DESC LIMIT 30
  `;

  let rows: any[];
  try {
    const result = await client.query(sql);
    rows = result.rows;
  } catch (e) {
    console.error(`Missing index check failed: ${e}`);
    return;
  }

  for (const row of rows) {
    const seqPct = round2(Number(row.seq_scan_pct));
    const rowCount = Number(row.n_live_tup);
    let severity = 'medium';
    if (seqPct > 95 && rowCount > 100_000) severity = 'critical';
    else if (seqPct > 90) severity = 'high';

    const schema = row.schemaname;
    const table = row.relname;

    findings.push({
      externalId: `missing-index-${schema}-${table}`,
      title: `Missing Index: ${schema}.${table}`,
      data: {
        category: 'missing_index',
        severity,
        table_name: table,
        schema_name: schema,
        seq_scan_pct: seqPct,
        row_count: rowCount,
        seq_scan: Number(row.seq_scan),
        idx_scan: Number(row.idx_scan),
        recommendation: `Table \`${schema}.${table}\` has ${rowCount} rows but ${seqPct}% sequential scans.\n\nIdentify the most common WHERE clauses for this table and add indexes:\n\n\`\`\`sql\n-- Example: replace 'column_name' with the actual filtered column\nCREATE INDEX CONCURRENTLY idx_${table}_<column>\nON ${schema}.${table} (<column_name>);\n\`\`\`\n\nRun \`EXPLAIN ANALYZE\` on your queries to confirm which columns need indexing.`,
      },
    });
  }
}

export async function findUnusedIndexes(client: any, findings: PgFinding[]): Promise<void> {
  const sql = `
    SELECT s.schemaname, s.relname, s.indexrelname,
           pg_relation_size(s.indexrelid)::bigint AS index_size,
           s.idx_scan::bigint
    FROM pg_stat_user_indexes s
    JOIN pg_index i ON s.indexrelid = i.indexrelid
    WHERE s.idx_scan = 0
      AND NOT i.indisprimary AND NOT i.indisunique
      AND pg_relation_size(s.indexrelid) > 1048576
    ORDER BY pg_relation_size(s.indexrelid) DESC LIMIT 30
  `;

  let rows: any[];
  try {
    const result = await client.query(sql);
    rows = result.rows;
  } catch (e) {
    console.error(`Unused index check failed: ${e}`);
    return;
  }

  for (const row of rows) {
    const indexSize = Number(row.index_size);
    const sizeMb = indexSize / (1024 * 1024);
    let severity = 'medium';
    if (sizeMb > 100) severity = 'critical';
    else if (sizeMb > 10) severity = 'high';

    const schema = row.schemaname;
    const indexName = row.indexrelname;

    findings.push({
      externalId: `unused-index-${schema}-${indexName}`,
      title: `Unused Index: ${schema}.${indexName}`,
      data: {
        category: 'unused_index',
        severity,
        index_name: indexName,
        schema_name: schema,
        table_name: row.relname,
        index_size_bytes: indexSize,
        index_size_mb: round2(sizeMb),
        recommendation: `Index \`${schema}.${indexName}\` (${sizeMb.toFixed(1)} MB) has never been used.\n\n\`\`\`sql\nDROP INDEX CONCURRENTLY ${schema}.${indexName};\n\`\`\`\n\n**Note:** Verify this index is not used by rarely-executed queries or maintenance jobs before dropping.`,
      },
    });
  }
}

export async function findVacuumNeeded(client: any, findings: PgFinding[]): Promise<void> {
  const sql = `
    SELECT schemaname, relname,
           n_live_tup::bigint, n_dead_tup::bigint,
           (CASE WHEN (n_live_tup + n_dead_tup) > 0
                 THEN (100.0 * n_dead_tup / (n_live_tup + n_dead_tup))
                 ELSE 0 END)::float8 AS dead_pct
    FROM pg_stat_user_tables
    WHERE n_dead_tup > 1000
      AND CASE WHEN (n_live_tup + n_dead_tup) > 0
               THEN (100.0 * n_dead_tup / (n_live_tup + n_dead_tup))
               ELSE 0 END > 10
    ORDER BY dead_pct DESC LIMIT 30
  `;

  let rows: any[];
  try {
    const result = await client.query(sql);
    rows = result.rows;
  } catch (e) {
    console.error(`Vacuum check failed: ${e}`);
    return;
  }

  for (const row of rows) {
    const deadPct = round2(Number(row.dead_pct));
    const dead = Number(row.n_dead_tup);
    const live = Number(row.n_live_tup);
    let severity = 'medium';
    if (deadPct > 50) severity = 'critical';
    else if (deadPct > 20) severity = 'high';

    const schema = row.schemaname;
    const table = row.relname;
    const total = live + dead;

    findings.push({
      externalId: `vacuum-${schema}-${table}`,
      title: `Vacuum Needed: ${schema}.${table}`,
      data: {
        category: 'vacuum_needed',
        severity,
        table_name: table,
        schema_name: schema,
        dead_pct: deadPct,
        n_dead_tup: dead,
        n_live_tup: live,
        row_count: total,
        recommendation: `Table \`${schema}.${table}\` has ${deadPct}% dead tuples (${dead} dead / ${total} total).\n\n**Immediate action:**\n\`\`\`sql\nVACUUM ANALYZE ${schema}.${table};\n\`\`\`\n\n**Tune autovacuum for this table:**\n\`\`\`sql\nALTER TABLE ${schema}.${table} SET (\n  autovacuum_vacuum_threshold = 50,\n  autovacuum_vacuum_scale_factor = 0.05,\n  autovacuum_analyze_threshold = 50,\n  autovacuum_analyze_scale_factor = 0.05\n);\n\`\`\``,
      },
    });
  }
}
