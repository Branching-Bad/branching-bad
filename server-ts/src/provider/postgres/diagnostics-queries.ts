// ---------------------------------------------------------------------------
// PostgreSQL Diagnostics — query-based checks (pg_stat_statements)
// ---------------------------------------------------------------------------

import type { PgFinding } from './models.js';
import { queryPreview, round2 } from './client.js';

export async function findSlowQueries(client: any, findings: PgFinding[]): Promise<void> {
  const sql = `
    SELECT queryid::bigint, query, calls::bigint,
           mean_exec_time::float8, total_exec_time::float8
    FROM pg_stat_statements
    WHERE mean_exec_time > 100 AND calls > 10
      AND query NOT LIKE '%pg_stat_statements%'
    ORDER BY mean_exec_time DESC LIMIT 50
  `;

  let rows: any[];
  try {
    const result = await client.query(sql);
    rows = result.rows;
  } catch (e) {
    console.error(`pg_stat_statements slow query check failed: ${e}`);
    return;
  }

  for (const row of rows) {
    const meanMs = Number(row.mean_exec_time);
    let severity = 'medium';
    if (meanMs > 5000) severity = 'critical';
    else if (meanMs > 500) severity = 'high';

    const preview = queryPreview(row.query);
    findings.push({
      externalId: `slow-query-${row.queryid}`,
      title: `Slow Query: ${preview}`,
      data: {
        category: 'slow_query',
        severity,
        query: row.query,
        queryid: String(row.queryid),
        calls: Number(row.calls),
        mean_ms: round2(meanMs),
        total_ms: round2(Number(row.total_exec_time)),
        recommendation: `Analyze this query with EXPLAIN (ANALYZE, BUFFERS):\n\n\`\`\`sql\nEXPLAIN (ANALYZE, BUFFERS) ${row.query.trim()}\n\`\`\`\n\nConsider adding indexes on columns used in WHERE/JOIN clauses.`,
      },
    });
  }
}

export async function findNPlusOne(client: any, findings: PgFinding[]): Promise<void> {
  const sql = `
    SELECT queryid::bigint, query, calls::bigint,
           mean_exec_time::float8, total_exec_time::float8
    FROM pg_stat_statements
    WHERE calls > 1000
      AND query ~* '^\\s*SELECT'
      AND query !~* '\\bJOIN\\b'
      AND query NOT LIKE '%pg_stat_statements%'
    ORDER BY calls DESC LIMIT 30
  `;

  let rows: any[];
  try {
    const result = await client.query(sql);
    rows = result.rows;
  } catch (e) {
    console.error(`pg_stat_statements N+1 check failed: ${e}`);
    return;
  }

  for (const row of rows) {
    const calls = Number(row.calls);
    let severity = 'medium';
    if (calls > 100_000) severity = 'critical';
    else if (calls > 10_000) severity = 'high';

    const preview = queryPreview(row.query);
    findings.push({
      externalId: `n1-${row.queryid}`,
      title: `Possible N+1: ${preview}`,
      data: {
        category: 'n_plus_one',
        severity,
        query: row.query,
        queryid: String(row.queryid),
        calls,
        mean_ms: round2(Number(row.mean_exec_time)),
        total_ms: round2(Number(row.total_exec_time)),
        recommendation: `This query has been called ${calls} times without a JOIN, suggesting an N+1 pattern.\n\n**Original query:**\n\`\`\`sql\n${row.query.trim()}\n\`\`\`\n\nConsider:\n1. Rewriting as a single query with JOIN\n2. Using batch loading (WHERE id IN (...))\n3. Adding eager loading in the ORM layer`,
      },
    });
  }
}
