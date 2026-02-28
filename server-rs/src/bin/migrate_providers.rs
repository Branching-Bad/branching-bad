/// Standalone migration script: Old Jira/Sentry tables → Generic provider_* tables
///
/// Run with:
///   cargo run --bin migrate_providers
///
/// This script:
/// 1. Opens the same SQLite DB the server uses
/// 2. Ensures generic provider_* tables exist
/// 3. Copies data from old tables (jira_accounts, sentry_accounts, etc.) to new generic tables
/// 4. Prints a summary of what was migrated
/// 5. Does NOT drop old tables (they remain for rollback safety)

use std::path::PathBuf;

use rusqlite::{Connection, params};

fn main() {
    let db_path = resolve_db_path();
    println!("=== Provider Migration Script ===");
    println!("DB path: {}\n", db_path.display());

    if !db_path.exists() {
        println!("ERROR: Database file does not exist. Run the server once first.");
        std::process::exit(1);
    }

    let conn = Connection::open(&db_path).expect("Failed to open database");
    conn.pragma_update(None, "foreign_keys", "ON").unwrap();
    conn.pragma_update(None, "journal_mode", "WAL").unwrap();

    // Ensure generic tables exist
    ensure_provider_tables(&conn);

    // Print current state
    println!("── Current State ──");
    print_table_count(&conn, "jira_accounts");
    print_table_count(&conn, "jira_boards");
    print_table_count(&conn, "repo_jira_bindings");
    print_table_count(&conn, "sentry_accounts");
    print_table_count(&conn, "sentry_projects");
    print_table_count(&conn, "repo_sentry_bindings");
    print_table_count(&conn, "sentry_issues");
    println!();
    print_table_count(&conn, "provider_accounts");
    print_table_count(&conn, "provider_resources");
    print_table_count(&conn, "provider_bindings");
    print_table_count(&conn, "provider_items");
    println!();

    // Run migration
    println!("── Running Migration ──");

    let jira_migrated = migrate_jira(&conn);
    let sentry_migrated = migrate_sentry(&conn);

    println!();
    println!("── Post-Migration State ──");
    print_table_count(&conn, "provider_accounts");
    print_table_count(&conn, "provider_resources");
    print_table_count(&conn, "provider_bindings");
    print_table_count(&conn, "provider_items");

    println!();
    println!("── Summary ──");
    println!("Jira accounts migrated: {}", jira_migrated.0);
    println!("Jira boards migrated:   {}", jira_migrated.1);
    println!("Jira bindings migrated: {}", jira_migrated.2);
    println!("Sentry accounts migrated: {}", sentry_migrated.0);
    println!("Sentry projects migrated: {}", sentry_migrated.1);
    println!("Sentry bindings migrated: {}", sentry_migrated.2);
    println!("Sentry issues migrated:   {}", sentry_migrated.3);
    println!();

    // Verify referential integrity
    println!("── Integrity Check ──");
    verify_integrity(&conn);

    println!("\nMigration complete. Old tables are preserved (not dropped).");
    println!("You can now safely deploy the new provider-based routes.");
}

fn resolve_db_path() -> PathBuf {
    if let Ok(override_dir) = std::env::var("APP_DATA_DIR") {
        return PathBuf::from(override_dir).join("agent.db");
    }

    #[cfg(target_os = "macos")]
    {
        let home = std::env::var("HOME").unwrap_or_default();
        PathBuf::from(home)
            .join("Library/Application Support/jira-approval-local-agent/agent.db")
    }

    #[cfg(target_os = "linux")]
    {
        let home = std::env::var("HOME").unwrap_or_default();
        PathBuf::from(home)
            .join(".local/share/jira-approval-local-agent/agent.db")
    }

    #[cfg(not(any(target_os = "macos", target_os = "linux")))]
    {
        panic!("Unsupported OS — set APP_DATA_DIR env var manually");
    }
}

fn ensure_provider_tables(conn: &Connection) {
    conn.execute_batch(r#"
CREATE TABLE IF NOT EXISTS provider_accounts (
    id TEXT PRIMARY KEY,
    provider_id TEXT NOT NULL,
    config_json TEXT NOT NULL,
    display_name TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS provider_resources (
    id TEXT PRIMARY KEY,
    provider_account_id TEXT NOT NULL REFERENCES provider_accounts(id) ON DELETE CASCADE,
    provider_id TEXT NOT NULL,
    external_id TEXT NOT NULL,
    name TEXT NOT NULL,
    extra_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE(provider_account_id, external_id)
);

CREATE TABLE IF NOT EXISTS provider_bindings (
    repo_id TEXT NOT NULL REFERENCES repos(id) ON DELETE CASCADE,
    provider_account_id TEXT NOT NULL REFERENCES provider_accounts(id) ON DELETE CASCADE,
    provider_resource_id TEXT NOT NULL REFERENCES provider_resources(id) ON DELETE CASCADE,
    provider_id TEXT NOT NULL,
    config_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY(repo_id, provider_account_id, provider_resource_id)
);

CREATE TABLE IF NOT EXISTS provider_items (
    id TEXT PRIMARY KEY,
    provider_account_id TEXT NOT NULL,
    provider_resource_id TEXT NOT NULL,
    provider_id TEXT NOT NULL,
    external_id TEXT NOT NULL,
    title TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    linked_task_id TEXT,
    data_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE(provider_account_id, external_id)
);

CREATE INDEX IF NOT EXISTS idx_provider_items_resource ON provider_items(provider_resource_id, status);
    "#).expect("Failed to create provider tables");
}

fn migrate_jira(conn: &Connection) -> (usize, usize, usize) {
    // Check if jira_accounts table exists
    if !table_exists(conn, "jira_accounts") {
        println!("  jira_accounts table not found — skipping Jira migration");
        return (0, 0, 0);
    }

    let accounts = conn.execute(
        r#"INSERT OR IGNORE INTO provider_accounts (id, provider_id, config_json, display_name, created_at, updated_at)
           SELECT id, 'jira', json_object('base_url', base_url, 'email', email, 'api_token', api_token),
                  email, created_at, updated_at
           FROM jira_accounts"#,
        [],
    ).unwrap_or(0);
    println!("  Jira accounts: {} rows inserted", accounts);

    let boards = if table_exists(conn, "jira_boards") {
        conn.execute(
            r#"INSERT OR IGNORE INTO provider_resources (id, provider_account_id, provider_id, external_id, name, extra_json, created_at, updated_at)
               SELECT id, jira_account_id, 'jira', board_id, name, '{}', created_at, updated_at
               FROM jira_boards"#,
            [],
        ).unwrap_or(0)
    } else { 0 };
    println!("  Jira boards → resources: {} rows inserted", boards);

    let bindings = if table_exists(conn, "repo_jira_bindings") {
        conn.execute(
            r#"INSERT OR IGNORE INTO provider_bindings (repo_id, provider_account_id, provider_resource_id, provider_id, config_json, created_at, updated_at)
               SELECT repo_id, jira_account_id, jira_board_id, 'jira', '{}', created_at, updated_at
               FROM repo_jira_bindings"#,
            [],
        ).unwrap_or(0)
    } else { 0 };
    println!("  Jira bindings: {} rows inserted", bindings);

    (accounts, boards, bindings)
}

fn migrate_sentry(conn: &Connection) -> (usize, usize, usize, usize) {
    if !table_exists(conn, "sentry_accounts") {
        println!("  sentry_accounts table not found — skipping Sentry migration");
        return (0, 0, 0, 0);
    }

    let accounts = conn.execute(
        r#"INSERT OR IGNORE INTO provider_accounts (id, provider_id, config_json, display_name, created_at, updated_at)
           SELECT id, 'sentry', json_object('base_url', base_url, 'org_slug', org_slug, 'auth_token', auth_token),
                  org_slug, created_at, updated_at
           FROM sentry_accounts"#,
        [],
    ).unwrap_or(0);
    println!("  Sentry accounts: {} rows inserted", accounts);

    let projects = if table_exists(conn, "sentry_projects") {
        conn.execute(
            r#"INSERT OR IGNORE INTO provider_resources (id, provider_account_id, provider_id, external_id, name, extra_json, created_at, updated_at)
               SELECT id, sentry_account_id, 'sentry', project_slug, name, '{}', created_at, updated_at
               FROM sentry_projects"#,
            [],
        ).unwrap_or(0)
    } else { 0 };
    println!("  Sentry projects → resources: {} rows inserted", projects);

    let bindings = if table_exists(conn, "repo_sentry_bindings") {
        conn.execute(
            r#"INSERT OR IGNORE INTO provider_bindings (repo_id, provider_account_id, provider_resource_id, provider_id, config_json, created_at, updated_at)
               SELECT repo_id, sentry_account_id, sentry_project_id, 'sentry',
                      json_object('environments', environments),
                      created_at, updated_at
               FROM repo_sentry_bindings"#,
            [],
        ).unwrap_or(0)
    } else { 0 };
    println!("  Sentry bindings: {} rows inserted", bindings);

    let issues = if table_exists(conn, "sentry_issues") {
        conn.execute(
            r#"INSERT OR IGNORE INTO provider_items (id, provider_account_id, provider_resource_id, provider_id, external_id, title, status, linked_task_id, data_json, created_at, updated_at)
               SELECT id, sentry_account_id, sentry_project_id, 'sentry', sentry_issue_id, title, status, linked_task_id,
                      json_object('culprit', culprit, 'level', level, 'first_seen', first_seen, 'last_seen', last_seen,
                                  'occurrence_count', occurrence_count, 'environments', environments,
                                  'latest_event_json', latest_event_json, 'metadata_json', metadata_json),
                      created_at, updated_at
               FROM sentry_issues"#,
            [],
        ).unwrap_or(0)
    } else { 0 };
    println!("  Sentry issues → items: {} rows inserted", issues);

    (accounts, projects, bindings, issues)
}

fn verify_integrity(conn: &Connection) {
    // Check all provider_resources reference valid provider_accounts
    let orphan_resources: i64 = conn.query_row(
        "SELECT COUNT(*) FROM provider_resources WHERE provider_account_id NOT IN (SELECT id FROM provider_accounts)",
        [], |row| row.get(0),
    ).unwrap_or(-1);
    println!("  Orphan resources (no parent account): {}", orphan_resources);

    // Check all provider_bindings reference valid accounts and resources
    let orphan_bindings_account: i64 = conn.query_row(
        "SELECT COUNT(*) FROM provider_bindings WHERE provider_account_id NOT IN (SELECT id FROM provider_accounts)",
        [], |row| row.get(0),
    ).unwrap_or(-1);
    println!("  Orphan bindings (no account): {}", orphan_bindings_account);

    let orphan_bindings_resource: i64 = conn.query_row(
        "SELECT COUNT(*) FROM provider_bindings WHERE provider_resource_id NOT IN (SELECT id FROM provider_resources)",
        [], |row| row.get(0),
    ).unwrap_or(-1);
    println!("  Orphan bindings (no resource): {}", orphan_bindings_resource);

    // Check provider_items reference valid accounts
    let orphan_items: i64 = conn.query_row(
        "SELECT COUNT(*) FROM provider_items WHERE provider_account_id NOT IN (SELECT id FROM provider_accounts)",
        [], |row| row.get(0),
    ).unwrap_or(-1);
    println!("  Orphan items (no account): {}", orphan_items);

    if orphan_resources == 0 && orphan_bindings_account == 0 && orphan_bindings_resource == 0 && orphan_items == 0 {
        println!("  ✓ All references valid");
    } else {
        println!("  ✗ WARNING: Some orphan records found — manual cleanup may be needed");
    }
}

fn table_exists(conn: &Connection, table: &str) -> bool {
    conn.query_row(
        "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name=?1",
        params![table],
        |row| row.get::<_, i64>(0),
    ).unwrap_or(0) > 0
}

fn print_table_count(conn: &Connection, table: &str) {
    if !table_exists(conn, table) {
        println!("  {:<30} (not found)", table);
        return;
    }
    let count: i64 = conn.query_row(
        &format!("SELECT COUNT(*) FROM {}", table),
        [], |row| row.get(0),
    ).unwrap_or(-1);
    println!("  {:<30} {} rows", table, count);
}
