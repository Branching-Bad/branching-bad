use anyhow::Result;
use rusqlite::params;
use uuid::Uuid;

use crate::models::ReviewComment;

use super::{Db, now_iso};

impl Db {
    pub fn add_review_comment(
        &self,
        task_id: &str,
        run_id: &str,
        comment: &str,
    ) -> Result<ReviewComment> {
        let conn = self.connect()?;
        let id = Uuid::new_v4().to_string();
        let ts = now_iso();
        conn.execute(
            "INSERT INTO review_comments (id, task_id, run_id, comment, status, created_at) VALUES (?1, ?2, ?3, ?4, 'pending', ?5)",
            params![id, task_id, run_id, comment, ts],
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
        })
    }

    pub fn list_review_comments(&self, task_id: &str) -> Result<Vec<ReviewComment>> {
        let conn = self.connect()?;
        let mut stmt = conn.prepare(
            "SELECT id, task_id, run_id, comment, status, result_run_id, addressed_at, created_at FROM review_comments WHERE task_id = ?1 ORDER BY created_at ASC",
        )?;
        let rows = stmt.query_map([task_id], |row| {
            Ok(ReviewComment {
                id: row.get(0)?,
                task_id: row.get(1)?,
                run_id: row.get(2)?,
                comment: row.get(3)?,
                status: row.get(4)?,
                result_run_id: row.get(5)?,
                addressed_at: row.get(6)?,
                created_at: row.get(7)?,
            })
        })?;
        rows.collect::<std::result::Result<Vec<_>, _>>()
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
}
