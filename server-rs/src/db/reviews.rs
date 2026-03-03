use anyhow::Result;
use rusqlite::{params, OptionalExtension};
use uuid::Uuid;

use crate::models::ReviewComment;

use super::{Db, now_iso};

fn map_review_comment_row(row: &rusqlite::Row) -> rusqlite::Result<ReviewComment> {
    Ok(ReviewComment {
        id: row.get(0)?,
        task_id: row.get(1)?,
        run_id: row.get(2)?,
        comment: row.get(3)?,
        status: row.get(4)?,
        result_run_id: row.get(5)?,
        addressed_at: row.get(6)?,
        created_at: row.get(7)?,
        file_path: row.get(8)?,
        line_start: row.get(9)?,
        line_end: row.get(10)?,
        diff_hunk: row.get(11)?,
        review_mode: row.get::<_, Option<String>>(12)?.unwrap_or_else(|| "instant".to_string()),
        batch_id: row.get(13)?,
    })
}

impl Db {
    pub fn add_review_comment_full(
        &self,
        task_id: &str,
        run_id: &str,
        comment: &str,
        file_path: Option<&str>,
        line_start: Option<i64>,
        line_end: Option<i64>,
        diff_hunk: Option<&str>,
        review_mode: &str,
        batch_id: Option<&str>,
    ) -> Result<ReviewComment> {
        let conn = self.connect()?;
        let id = Uuid::new_v4().to_string();
        let ts = now_iso();
        conn.execute(
            "INSERT INTO review_comments (id, task_id, run_id, comment, status, file_path, line_start, line_end, diff_hunk, review_mode, batch_id, created_at) VALUES (?1, ?2, ?3, ?4, 'pending', ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
            params![id, task_id, run_id, comment, file_path, line_start, line_end, diff_hunk, review_mode, batch_id, ts],
        )?;
        Ok(ReviewComment {
            id,
            task_id: task_id.to_string(),
            run_id: run_id.to_string(),
            comment: comment.to_string(),
            status: "pending".to_string(),
            result_run_id: None,
            addressed_at: None,
            created_at: ts,
            file_path: file_path.map(|s| s.to_string()),
            line_start,
            line_end,
            diff_hunk: diff_hunk.map(|s| s.to_string()),
            review_mode: review_mode.to_string(),
            batch_id: batch_id.map(|s| s.to_string()),
        })
    }

    pub fn list_review_comments(&self, task_id: &str) -> Result<Vec<ReviewComment>> {
        let conn = self.connect()?;
        let mut stmt = conn.prepare(
            "SELECT id, task_id, run_id, comment, status, result_run_id, addressed_at, created_at, file_path, line_start, line_end, diff_hunk, review_mode, batch_id FROM review_comments WHERE task_id = ?1 ORDER BY created_at ASC",
        )?;
        let rows = stmt.query_map([task_id], |row| map_review_comment_row(row))?;
        rows.collect::<std::result::Result<Vec<_>, _>>()
            .map_err(anyhow::Error::from)
    }

    pub fn get_review_comment_by_id(&self, id: &str) -> Result<Option<ReviewComment>> {
        let conn = self.connect()?;
        conn.query_row(
            "SELECT id, task_id, run_id, comment, status, result_run_id, addressed_at, created_at, file_path, line_start, line_end, diff_hunk, review_mode, batch_id FROM review_comments WHERE id = ?1",
            [id],
            |row| map_review_comment_row(row),
        )
        .optional()
        .map_err(anyhow::Error::from)
    }

    pub fn update_review_comment_status(
        &self,
        id: &str,
        status: &str,
        result_run_id: Option<&str>,
    ) -> Result<()> {
        let conn = self.connect()?;
        let addressed_at: Option<String> = if status == "addressed" {
            Some(now_iso())
        } else {
            None
        };
        conn.execute(
            "UPDATE review_comments SET status = ?1, result_run_id = ?2, addressed_at = ?3 WHERE id = ?4",
            params![status, result_run_id, addressed_at, id],
        )?;
        Ok(())
    }

    pub fn save_run_diff(&self, run_id: &str, diff_text: &str) -> Result<()> {
        let conn = self.connect()?;
        let ts = now_iso();
        conn.execute(
            "INSERT OR REPLACE INTO run_diffs (run_id, diff_text, created_at) VALUES (?1, ?2, ?3)",
            params![run_id, diff_text, ts],
        )?;
        Ok(())
    }

    pub fn get_run_diff(&self, run_id: &str) -> Result<Option<String>> {
        let conn = self.connect()?;
        let mut stmt = conn.prepare(
            "SELECT diff_text FROM run_diffs WHERE run_id = ?1",
        )?;
        let result = stmt.query_row([run_id], |row| row.get(0)).optional()?;
        Ok(result)
    }
}
