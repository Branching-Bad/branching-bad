mod agents;
mod autostart;
pub mod chat;
pub mod es_investigations;
pub mod investigations;
mod maintenance;
mod plan_jobs;
mod plans;
mod providers;
mod repos;
mod reviews;
mod runs;
mod sonar_scans;
mod tasks;

use std::path::PathBuf;

use anyhow::{Context, Result};
use chrono::Utc;
use rusqlite::Connection;

mod embedded {
    use refinery::embed_migrations;
    embed_migrations!("migrations");
}

pub struct Db {
    pub path: PathBuf,
}

#[derive(Debug, Clone)]
pub struct UpsertTaskTransition {
    pub task_id: String,
    pub is_new: bool,
    pub previous_status: Option<String>,
    pub current_status: String,
}

#[derive(Debug, Clone)]
pub struct UpsertTasksResult {
    pub synced: usize,
    pub transitions: Vec<UpsertTaskTransition>,
}

impl Db {
    pub fn new(path: PathBuf) -> Self {
        Self { path }
    }

    pub fn connect(&self) -> Result<Connection> {
        let conn = Connection::open(&self.path)
            .with_context(|| format!("failed to open sqlite: {}", self.path.display()))?;
        conn.pragma_update(None, "foreign_keys", "ON")?;
        conn.pragma_update(None, "journal_mode", "WAL")?;
        Ok(conn)
    }

    pub fn init(&self) -> Result<()> {
        let mut conn = self.connect()?;
        embedded::migrations::runner()
            .run(&mut conn)
            .context("failed to run database migrations")?;
        Ok(())
    }

    pub fn db_path_string(&self) -> String {
        self.path.to_string_lossy().to_string()
    }
}

fn now_iso() -> String {
    Utc::now().to_rfc3339()
}
