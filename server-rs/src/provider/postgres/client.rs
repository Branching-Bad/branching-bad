use anyhow::{Context, Result};
use serde_json::{Value, json};
use tokio_postgres::{Client, NoTls, config::Config as PgConfig};

/// Diagnostic finding from PostgreSQL analysis
pub struct PgFinding {
    pub external_id: String,
    pub title: String,
    pub data: Value,
}

pub struct PgClient {
    client: Client,
}

impl PgClient {
    /// Connect using either a connection string or individual fields from config JSON.
    pub async fn connect(config: &Value) -> Result<Self> {
        let conn_string = config["connection_string"]
            .as_str()
            .filter(|s| !s.is_empty());

        let pg_config = if let Some(cs) = conn_string {
            normalize_connection_string(cs)
                .parse::<PgConfig>()
                .context("invalid PostgreSQL connection string")?
        } else {
            let host = config["host"].as_str().unwrap_or("localhost");
            let port = config["port"]
                .as_str()
                .and_then(|s| s.parse::<u16>().ok())
                .unwrap_or(5432);
            let dbname = config["dbname"].as_str().unwrap_or("postgres");
            let user = config["user"].as_str().unwrap_or("postgres");
            let password = config["password"].as_str().unwrap_or("");

            let mut c = PgConfig::new();
            c.host(host);
            c.port(port);
            c.dbname(dbname);
            c.user(user);
            if !password.is_empty() {
                c.password(password);
            }
            if let Some(ssl) = config["sslmode"].as_str().filter(|s| !s.is_empty()) {
                c.ssl_mode(match ssl {
                    "require" => tokio_postgres::config::SslMode::Require,
                    "prefer" => tokio_postgres::config::SslMode::Prefer,
                    _ => tokio_postgres::config::SslMode::Disable,
                });
            }
            c
        };

        let (client, connection) = pg_config
            .connect(NoTls)
            .await
            .context("failed to connect to PostgreSQL")?;

        // Spawn connection task
        tokio::spawn(async move {
            if let Err(e) = connection.await {
                eprintln!("PostgreSQL connection error: {e}");
            }
        });

        Ok(Self { client })
    }

    /// Validate connection by running a simple query. Returns server version.
    pub async fn validate(&self) -> Result<String> {
        let row = self
            .client
            .query_one("SELECT version()", &[])
            .await
            .context("failed to query PostgreSQL version")?;
        let version: String = row.get(0);
        Ok(version)
    }

    /// Get the current database name.
    pub async fn current_database(&self) -> Result<String> {
        let row = self
            .client
            .query_one("SELECT current_database()", &[])
            .await?;
        Ok(row.get(0))
    }

    /// Run all diagnostic queries and return findings.
    pub async fn run_diagnostics(&self) -> Result<Vec<PgFinding>> {
        let mut findings = Vec::new();

        let has_pg_stat_statements = self.check_pg_stat_statements().await;

        if has_pg_stat_statements {
            self.find_slow_queries(&mut findings).await;
            self.find_n_plus_one(&mut findings).await;
        }

        self.find_missing_indexes(&mut findings).await;
        self.find_unused_indexes(&mut findings).await;
        self.find_vacuum_needed(&mut findings).await;

        Ok(findings)
    }

    async fn check_pg_stat_statements(&self) -> bool {
        self.client
            .query_one(
                "SELECT 1 FROM pg_extension WHERE extname = 'pg_stat_statements'",
                &[],
            )
            .await
            .is_ok()
    }

    /// Slow queries: mean_exec_time > 100ms, calls > 10
    async fn find_slow_queries(&self, findings: &mut Vec<PgFinding>) {
        let sql = r#"
            SELECT queryid::bigint, query, calls::bigint,
                   mean_exec_time::float8, total_exec_time::float8
            FROM pg_stat_statements
            WHERE mean_exec_time > 100
              AND calls > 10
              AND query NOT LIKE '%pg_stat_statements%'
            ORDER BY mean_exec_time DESC
            LIMIT 50
        "#;

        let rows = match self.client.query(sql, &[]).await {
            Ok(r) => r,
            Err(e) => {
                eprintln!("pg_stat_statements slow query check failed: {e}");
                return;
            }
        };

        for row in rows {
            let queryid: i64 = row.get(0);
            let query: String = row.get(1);
            let calls: i64 = row.get(2);
            let mean_ms: f64 = row.get(3);
            let total_ms: f64 = row.get(4);

            let severity = if mean_ms > 5000.0 {
                "critical"
            } else if mean_ms > 500.0 {
                "high"
            } else {
                "medium"
            };

            let preview = query_preview(&query);
            findings.push(PgFinding {
                external_id: format!("slow-query-{queryid}"),
                title: format!("Slow Query: {preview}"),
                data: json!({
                    "category": "slow_query",
                    "severity": severity,
                    "query": query,
                    "queryid": queryid.to_string(),
                    "calls": calls,
                    "mean_ms": round2(mean_ms),
                    "total_ms": round2(total_ms),
                    "recommendation": format!(
                        "Analyze this query with EXPLAIN (ANALYZE, BUFFERS):\n\n```sql\nEXPLAIN (ANALYZE, BUFFERS) {}\n```\n\nConsider adding indexes on columns used in WHERE/JOIN clauses.",
                        query.trim()
                    )
                }),
            });
        }
    }

    /// N+1 pattern: calls > 1000, SELECT, no JOIN
    async fn find_n_plus_one(&self, findings: &mut Vec<PgFinding>) {
        let sql = r#"
            SELECT queryid::bigint, query, calls::bigint,
                   mean_exec_time::float8, total_exec_time::float8
            FROM pg_stat_statements
            WHERE calls > 1000
              AND query ~* '^\s*SELECT'
              AND query !~* '\bJOIN\b'
              AND query NOT LIKE '%pg_stat_statements%'
            ORDER BY calls DESC
            LIMIT 30
        "#;

        let rows = match self.client.query(sql, &[]).await {
            Ok(r) => r,
            Err(e) => {
                eprintln!("pg_stat_statements N+1 check failed: {e}");
                return;
            }
        };

        for row in rows {
            let queryid: i64 = row.get(0);
            let query: String = row.get(1);
            let calls: i64 = row.get(2);
            let mean_ms: f64 = row.get(3);
            let total_ms: f64 = row.get(4);

            let severity = if calls > 100_000 {
                "critical"
            } else if calls > 10_000 {
                "high"
            } else {
                "medium"
            };

            let preview = query_preview(&query);
            findings.push(PgFinding {
                external_id: format!("n1-{queryid}"),
                title: format!("Possible N+1: {preview}"),
                data: json!({
                    "category": "n_plus_one",
                    "severity": severity,
                    "query": query,
                    "queryid": queryid.to_string(),
                    "calls": calls,
                    "mean_ms": round2(mean_ms),
                    "total_ms": round2(total_ms),
                    "recommendation": format!(
                        "This query has been called {} times without a JOIN, suggesting an N+1 pattern.\n\n\
                         **Original query:**\n```sql\n{}\n```\n\n\
                         Consider:\n\
                         1. Rewriting as a single query with JOIN\n\
                         2. Using batch loading (WHERE id IN (...))\n\
                         3. Adding eager loading in the ORM layer",
                        calls,
                        query.trim()
                    )
                }),
            });
        }
    }

    /// Missing indexes: high seq_scan ratio on tables with > 10k rows
    async fn find_missing_indexes(&self, findings: &mut Vec<PgFinding>) {
        let sql = r#"
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
            ORDER BY seq_scan_pct DESC, n_live_tup DESC
            LIMIT 30
        "#;

        let rows = match self.client.query(sql, &[]).await {
            Ok(r) => r,
            Err(e) => {
                eprintln!("Missing index check failed: {e}");
                return;
            }
        };

        for row in rows {
            let schema: String = row.get(0);
            let table: String = row.get(1);
            let seq_scan: i64 = row.get(2);
            let idx_scan: i64 = row.get(3);
            let row_count: i64 = row.get(4);
            let seq_pct: f64 = row.get(5);
            let seq_pct = round2(seq_pct);

            let severity = if seq_pct > 95.0 && row_count > 100_000 {
                "critical"
            } else if seq_pct > 90.0 {
                "high"
            } else {
                "medium"
            };

            findings.push(PgFinding {
                external_id: format!("missing-index-{schema}-{table}"),
                title: format!("Missing Index: {schema}.{table}"),
                data: json!({
                    "category": "missing_index",
                    "severity": severity,
                    "table_name": table,
                    "schema_name": schema,
                    "seq_scan_pct": seq_pct,
                    "row_count": row_count,
                    "seq_scan": seq_scan,
                    "idx_scan": idx_scan,
                    "recommendation": format!(
                        "Table `{schema}.{table}` has {row_count} rows but {seq_pct}% sequential scans.\n\n\
                         Identify the most common WHERE clauses for this table and add indexes:\n\n\
                         ```sql\n-- Example: replace 'column_name' with the actual filtered column\n\
                         CREATE INDEX CONCURRENTLY idx_{table}_<column>\n\
                         ON {schema}.{table} (<column_name>);\n```\n\n\
                         Run `EXPLAIN ANALYZE` on your queries to confirm which columns need indexing."
                    )
                }),
            });
        }
    }

    /// Unused indexes: idx_scan = 0, not primary/unique, > 1MB
    async fn find_unused_indexes(&self, findings: &mut Vec<PgFinding>) {
        let sql = r#"
            SELECT s.schemaname, s.relname, s.indexrelname,
                   pg_relation_size(s.indexrelid)::bigint AS index_size,
                   s.idx_scan::bigint
            FROM pg_stat_user_indexes s
            JOIN pg_index i ON s.indexrelid = i.indexrelid
            WHERE s.idx_scan = 0
              AND NOT i.indisprimary
              AND NOT i.indisunique
              AND pg_relation_size(s.indexrelid) > 1048576
            ORDER BY pg_relation_size(s.indexrelid) DESC
            LIMIT 30
        "#;

        let rows = match self.client.query(sql, &[]).await {
            Ok(r) => r,
            Err(e) => {
                eprintln!("Unused index check failed: {e}");
                return;
            }
        };

        for row in rows {
            let schema: String = row.get(0);
            let table: String = row.get(1);
            let index_name: String = row.get(2);
            let index_size: i64 = row.get(3);
            let _idx_scan: i64 = row.get(4);

            let size_mb = index_size as f64 / (1024.0 * 1024.0);

            let severity = if size_mb > 100.0 {
                "critical"
            } else if size_mb > 10.0 {
                "high"
            } else {
                "medium"
            };

            findings.push(PgFinding {
                external_id: format!("unused-index-{schema}-{index_name}"),
                title: format!("Unused Index: {schema}.{index_name}"),
                data: json!({
                    "category": "unused_index",
                    "severity": severity,
                    "index_name": index_name,
                    "schema_name": schema,
                    "table_name": table,
                    "index_size_bytes": index_size,
                    "index_size_mb": round2(size_mb),
                    "recommendation": format!(
                        "Index `{schema}.{index_name}` ({:.1} MB) has never been used.\n\n\
                         ```sql\nDROP INDEX CONCURRENTLY {schema}.{index_name};\n```\n\n\
                         **Note:** Verify this index is not used by rarely-executed queries or maintenance jobs before dropping.",
                        size_mb
                    )
                }),
            });
        }
    }

    /// Vacuum needed: dead tuple ratio > 10%, n_dead_tup > 1000
    async fn find_vacuum_needed(&self, findings: &mut Vec<PgFinding>) {
        let sql = r#"
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
            ORDER BY dead_pct DESC
            LIMIT 30
        "#;

        let rows = match self.client.query(sql, &[]).await {
            Ok(r) => r,
            Err(e) => {
                eprintln!("Vacuum check failed: {e}");
                return;
            }
        };

        for row in rows {
            let schema: String = row.get(0);
            let table: String = row.get(1);
            let live: i64 = row.get(2);
            let dead: i64 = row.get(3);
            let dead_pct: f64 = row.get(4);
            let dead_pct = round2(dead_pct);

            let severity = if dead_pct > 50.0 {
                "critical"
            } else if dead_pct > 20.0 {
                "high"
            } else {
                "medium"
            };

            findings.push(PgFinding {
                external_id: format!("vacuum-{schema}-{table}"),
                title: format!("Vacuum Needed: {schema}.{table}"),
                data: json!({
                    "category": "vacuum_needed",
                    "severity": severity,
                    "table_name": table,
                    "schema_name": schema,
                    "dead_pct": dead_pct,
                    "n_dead_tup": dead,
                    "n_live_tup": live,
                    "row_count": live + dead,
                    "recommendation": format!(
                        "Table `{schema}.{table}` has {dead_pct}% dead tuples ({dead} dead / {} total).\n\n\
                         **Immediate action:**\n```sql\nVACUUM ANALYZE {schema}.{table};\n```\n\n\
                         **Tune autovacuum for this table:**\n```sql\n\
                         ALTER TABLE {schema}.{table} SET (\n\
                           autovacuum_vacuum_threshold = 50,\n\
                           autovacuum_vacuum_scale_factor = 0.05,\n\
                           autovacuum_analyze_threshold = 50,\n\
                           autovacuum_analyze_scale_factor = 0.05\n\
                         );\n```",
                        live + dead
                    )
                }),
            });
        }
    }
}

/// Normalize connection strings from various formats into libpq key=value format.
/// Supports:
///   - libpq: `host=localhost port=5432 dbname=mydb` (returned as-is)
///   - URI:   `postgresql://user:pass@host:port/dbname` (returned as-is)
///   - ADO.NET: `Host=localhost;Port=5432;Database=mydb;Username=user;Password=pass`
fn normalize_connection_string(cs: &str) -> String {
    let trimmed = cs.trim();

    // Already a URI or libpq format — pass through
    if trimmed.starts_with("postgresql://")
        || trimmed.starts_with("postgres://")
        || !trimmed.contains('=')
    {
        return trimmed.to_string();
    }

    // ADO.NET style: semicolons separate Key=Value pairs
    if trimmed.contains(';') {
        let mut host = "localhost";
        let mut port = "5432";
        let mut dbname = "postgres";
        let mut user = "postgres";
        let mut password = "";
        let mut sslmode = "";

        for part in trimmed.split(';') {
            let part = part.trim();
            if part.is_empty() {
                continue;
            }
            if let Some((k, v)) = part.split_once('=') {
                match k.trim().to_lowercase().as_str() {
                    "host" | "server" | "data source" => host = v.trim(),
                    "port" => port = v.trim(),
                    "database" | "db" | "initial catalog" | "dbname" => dbname = v.trim(),
                    "username" | "user" | "user id" | "uid" => user = v.trim(),
                    "password" | "pwd" => password = v.trim(),
                    "sslmode" | "ssl mode" => sslmode = v.trim(),
                    _ => {}
                }
            }
        }

        let mut result = format!("host={host} port={port} dbname={dbname} user={user}");
        if !password.is_empty() {
            result.push_str(&format!(" password={password}"));
        }
        if !sslmode.is_empty() {
            result.push_str(&format!(" sslmode={sslmode}"));
        }
        return result;
    }

    // Assume libpq key=value (space-separated) — pass through
    trimmed.to_string()
}

fn query_preview(q: &str) -> String {
    let trimmed = q.trim().replace('\n', " ");
    if trimmed.len() > 80 {
        format!("{}…", &trimmed[..77])
    } else {
        trimmed
    }
}

fn round2(v: f64) -> f64 {
    (v * 100.0).round() / 100.0
}
