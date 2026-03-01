use anyhow::Result;
use rusqlite::{Row, params};
use serde::{Deserialize, Serialize};

use super::{Db, now_iso};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SonarScan {
    pub id: String,
    pub repo_id: String,
    pub account_id: String,
    pub project_key: String,
    pub status: String,
    pub issues_found: Option<i64>,
    pub error: Option<String>,
    pub created_at: String,
    pub completed_at: Option<String>,
}

const SELECT_COLS: &str =
    "id, repo_id, account_id, project_key, status, issues_found, error, created_at, completed_at";

fn row_to_scan(row: &Row) -> rusqlite::Result<SonarScan> {
    Ok(SonarScan {
        id: row.get(0)?,
        repo_id: row.get(1)?,
        account_id: row.get(2)?,
        project_key: row.get(3)?,
        status: row.get(4)?,
        issues_found: row.get(5)?,
        error: row.get(6)?,
        created_at: row.get(7)?,
        completed_at: row.get(8)?,
    })
}

impl Db {
    pub fn insert_sonar_scan(
        &self,
        id: &str,
        repo_id: &str,
        account_id: &str,
        project_key: &str,
    ) -> Result<()> {
        let conn = self.connect()?;
        let now = now_iso();
        conn.execute(
            "INSERT INTO sonar_scans (id, repo_id, account_id, project_key, status, created_at)
             VALUES (?1, ?2, ?3, ?4, 'running', ?5)",
            params![id, repo_id, account_id, project_key, now],
        )?;
        Ok(())
    }

    pub fn update_sonar_scan_status(
        &self,
        id: &str,
        status: &str,
        issues_found: Option<i64>,
        error: Option<&str>,
    ) -> Result<()> {
        let conn = self.connect()?;
        let completed_at = if status == "completed" || status == "failed" {
            Some(now_iso())
        } else {
            None
        };
        conn.execute(
            "UPDATE sonar_scans SET status = ?1, issues_found = ?2, error = ?3, completed_at = COALESCE(?4, completed_at) WHERE id = ?5",
            params![status, issues_found, error, completed_at, id],
        )?;
        Ok(())
    }

    pub fn get_sonar_scan(&self, id: &str) -> Result<Option<SonarScan>> {
        let conn = self.connect()?;
        let mut stmt = conn.prepare(
            &format!("SELECT {SELECT_COLS} FROM sonar_scans WHERE id = ?1"),
        )?;
        let mut rows = stmt.query_map(params![id], row_to_scan)?;
        Ok(rows.next().and_then(|r| r.ok()))
    }

    pub fn list_sonar_scans_by_repo(&self, repo_id: &str) -> Result<Vec<SonarScan>> {
        let conn = self.connect()?;
        let mut stmt = conn.prepare(
            &format!("SELECT {SELECT_COLS} FROM sonar_scans WHERE repo_id = ?1 ORDER BY created_at DESC LIMIT 20"),
        )?;
        let rows = stmt.query_map(params![repo_id], row_to_scan)?;
        Ok(rows.filter_map(|r| r.ok()).collect())
    }
}
