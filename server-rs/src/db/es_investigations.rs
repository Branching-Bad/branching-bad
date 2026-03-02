use anyhow::Result;
use rusqlite::{Row, params};
use serde::{Deserialize, Serialize};
use serde_json::Value;

use super::{Db, now_iso};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EsInvestigation {
    pub id: String,
    pub repo_id: String,
    pub provider_account_id: String,
    pub index_pattern: String,
    pub question: String,
    pub time_range_minutes: i64,
    pub query_phase1: Option<String>,
    pub query_phase2: Option<String>,
    pub result_json: Value,
    pub status: String,
    pub linked_task_id: Option<String>,
    pub error_message: Option<String>,
    pub created_at: String,
    pub completed_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EsInvestigationSummary {
    pub id: String,
    pub question: String,
    pub index_pattern: String,
    pub status: String,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EsSavedQuery {
    pub id: String,
    pub repo_id: String,
    pub index_pattern: String,
    pub label: String,
    pub question: String,
    pub query_template: String,
    pub keywords: String,
    pub use_count: i64,
    pub created_at: String,
    pub updated_at: String,
}

fn row_to_es_investigation(row: &Row) -> rusqlite::Result<EsInvestigation> {
    let result_str: String = row.get(8)?;
    Ok(EsInvestigation {
        id: row.get(0)?,
        repo_id: row.get(1)?,
        provider_account_id: row.get(2)?,
        index_pattern: row.get(3)?,
        question: row.get(4)?,
        time_range_minutes: row.get(5)?,
        query_phase1: row.get(6)?,
        query_phase2: row.get(7)?,
        result_json: serde_json::from_str(&result_str).unwrap_or_default(),
        status: row.get(9)?,
        linked_task_id: row.get(10)?,
        error_message: row.get(11)?,
        created_at: row.get(12)?,
        completed_at: row.get(13)?,
    })
}

impl Db {
    // ── ES Investigations ──

    pub fn create_es_investigation(
        &self,
        id: &str,
        repo_id: &str,
        provider_account_id: &str,
        index_pattern: &str,
        question: &str,
        time_range_minutes: i64,
    ) -> Result<EsInvestigation> {
        let conn = self.connect()?;
        let now = now_iso();
        conn.execute(
            "INSERT INTO es_investigations (id, repo_id, provider_account_id, index_pattern, question, time_range_minutes, status, result_json, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'running', '{}', ?7)",
            params![id, repo_id, provider_account_id, index_pattern, question, time_range_minutes, now],
        )?;
        self.get_es_investigation(id)
    }

    pub fn get_es_investigation(&self, id: &str) -> Result<EsInvestigation> {
        let conn = self.connect()?;
        let row = conn.query_row(
            "SELECT id, repo_id, provider_account_id, index_pattern, question, time_range_minutes,
                    query_phase1, query_phase2, result_json, status, linked_task_id,
                    error_message, created_at, completed_at
             FROM es_investigations WHERE id = ?1",
            params![id],
            row_to_es_investigation,
        )?;
        Ok(row)
    }

    pub fn update_es_investigation_status(
        &self,
        id: &str,
        status: &str,
        result_json: Option<&Value>,
        query_phase1: Option<&str>,
        error_message: Option<&str>,
    ) -> Result<()> {
        let conn = self.connect()?;
        let completed_at = if status == "completed" || status == "failed" || status == "no_results" {
            Some(now_iso())
        } else {
            None
        };

        if let Some(rj) = result_json {
            let rj_str = serde_json::to_string(rj)?;
            conn.execute(
                "UPDATE es_investigations SET status = ?1, result_json = ?2, query_phase1 = COALESCE(?3, query_phase1), error_message = ?4, completed_at = COALESCE(?5, completed_at) WHERE id = ?6",
                params![status, rj_str, query_phase1, error_message, completed_at, id],
            )?;
        } else {
            conn.execute(
                "UPDATE es_investigations SET status = ?1, query_phase1 = COALESCE(?2, query_phase1), error_message = ?3, completed_at = COALESCE(?4, completed_at) WHERE id = ?5",
                params![status, query_phase1, error_message, completed_at, id],
            )?;
        }
        Ok(())
    }

    pub fn set_es_investigation_linked_task(&self, id: &str, task_id: &str) -> Result<()> {
        let conn = self.connect()?;
        conn.execute(
            "UPDATE es_investigations SET linked_task_id = ?1 WHERE id = ?2",
            params![task_id, id],
        )?;
        Ok(())
    }

    pub fn list_es_investigations(&self, repo_id: &str) -> Result<Vec<EsInvestigationSummary>> {
        let conn = self.connect()?;
        let mut stmt = conn.prepare(
            "SELECT id, question, index_pattern, status, created_at
             FROM es_investigations WHERE repo_id = ?1 ORDER BY created_at DESC LIMIT 50",
        )?;
        let rows = stmt.query_map(params![repo_id], |row| {
            Ok(EsInvestigationSummary {
                id: row.get(0)?,
                question: row.get(1)?,
                index_pattern: row.get(2)?,
                status: row.get(3)?,
                created_at: row.get(4)?,
            })
        })?;
        Ok(rows.filter_map(|r| r.ok()).collect())
    }

    // ── ES Saved Queries ──

    pub fn create_es_saved_query(
        &self,
        id: &str,
        repo_id: &str,
        index_pattern: &str,
        label: &str,
        question: &str,
        query_template: &str,
        keywords: &str,
    ) -> Result<EsSavedQuery> {
        let conn = self.connect()?;
        let now = now_iso();
        conn.execute(
            "INSERT INTO es_saved_queries (id, repo_id, index_pattern, label, question, query_template, keywords, use_count, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 0, ?8, ?8)",
            params![id, repo_id, index_pattern, label, question, query_template, keywords, now],
        )?;
        self.get_es_saved_query(id)
    }

    pub fn get_es_saved_query(&self, id: &str) -> Result<EsSavedQuery> {
        let conn = self.connect()?;
        let row = conn.query_row(
            "SELECT id, repo_id, index_pattern, label, question, query_template, keywords, use_count, created_at, updated_at
             FROM es_saved_queries WHERE id = ?1",
            params![id],
            |row| {
                Ok(EsSavedQuery {
                    id: row.get(0)?,
                    repo_id: row.get(1)?,
                    index_pattern: row.get(2)?,
                    label: row.get(3)?,
                    question: row.get(4)?,
                    query_template: row.get(5)?,
                    keywords: row.get(6)?,
                    use_count: row.get(7)?,
                    created_at: row.get(8)?,
                    updated_at: row.get(9)?,
                })
            },
        )?;
        Ok(row)
    }

    pub fn list_es_saved_queries(&self, repo_id: &str) -> Result<Vec<EsSavedQuery>> {
        let conn = self.connect()?;
        let mut stmt = conn.prepare(
            "SELECT id, repo_id, index_pattern, label, question, query_template, keywords, use_count, created_at, updated_at
             FROM es_saved_queries WHERE repo_id = ?1 ORDER BY use_count DESC, updated_at DESC",
        )?;
        let rows = stmt.query_map(params![repo_id], |row| {
            Ok(EsSavedQuery {
                id: row.get(0)?,
                repo_id: row.get(1)?,
                index_pattern: row.get(2)?,
                label: row.get(3)?,
                question: row.get(4)?,
                query_template: row.get(5)?,
                keywords: row.get(6)?,
                use_count: row.get(7)?,
                created_at: row.get(8)?,
                updated_at: row.get(9)?,
            })
        })?;
        Ok(rows.filter_map(|r| r.ok()).collect())
    }

    pub fn delete_es_saved_query(&self, id: &str) -> Result<()> {
        let conn = self.connect()?;
        conn.execute("DELETE FROM es_saved_queries WHERE id = ?1", params![id])?;
        Ok(())
    }

    pub fn increment_es_saved_query_use_count(&self, id: &str) -> Result<()> {
        let conn = self.connect()?;
        let now = now_iso();
        conn.execute(
            "UPDATE es_saved_queries SET use_count = use_count + 1, updated_at = ?1 WHERE id = ?2",
            params![now, id],
        )?;
        Ok(())
    }
}
