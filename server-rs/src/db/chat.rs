use anyhow::Result;
use rusqlite::{Row, params};
use uuid::Uuid;

use crate::models::ChatMessage;

use super::{Db, now_iso};

fn row_to_chat_message(row: &Row) -> rusqlite::Result<ChatMessage> {
    Ok(ChatMessage {
        id: row.get(0)?,
        task_id: row.get(1)?,
        role: row.get(2)?,
        content: row.get(3)?,
        result_run_id: row.get(4)?,
        status: row.get(5)?,
        created_at: row.get(6)?,
    })
}

impl Db {
    pub fn insert_chat_message(
        &self,
        task_id: &str,
        role: &str,
        content: &str,
        status: &str,
    ) -> Result<ChatMessage> {
        let conn = self.connect()?;
        let id = Uuid::new_v4().to_string();
        let ts = now_iso();
        conn.execute(
            "INSERT INTO chat_messages (id, task_id, role, content, status, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![id, task_id, role, content, status, ts],
        )?;
        Ok(ChatMessage {
            id,
            task_id: task_id.to_string(),
            role: role.to_string(),
            content: content.to_string(),
            result_run_id: None,
            status: status.to_string(),
            created_at: ts,
        })
    }

    pub fn get_chat_messages(&self, task_id: &str) -> Result<Vec<ChatMessage>> {
        let conn = self.connect()?;
        let mut stmt = conn.prepare(
            "SELECT id, task_id, role, content, result_run_id, status, created_at FROM chat_messages WHERE task_id = ?1 ORDER BY created_at ASC",
        )?;
        let rows = stmt.query_map([task_id], row_to_chat_message)?;
        rows.collect::<std::result::Result<Vec<_>, _>>()
            .map_err(anyhow::Error::from)
    }

    pub fn get_next_queued_chat_message(&self, task_id: &str) -> Result<Option<ChatMessage>> {
        let conn = self.connect()?;
        let mut stmt = conn.prepare(
            "SELECT id, task_id, role, content, result_run_id, status, created_at FROM chat_messages WHERE task_id = ?1 AND status = 'queued' ORDER BY created_at ASC LIMIT 1",
        )?;
        let mut rows = stmt.query_map([task_id], row_to_chat_message)?;
        match rows.next() {
            Some(row) => Ok(Some(row?)),
            None => Ok(None),
        }
    }

    pub fn update_chat_message_status(
        &self,
        id: &str,
        status: &str,
        result_run_id: Option<&str>,
    ) -> Result<()> {
        let conn = self.connect()?;
        conn.execute(
            "UPDATE chat_messages SET status = ?1, result_run_id = ?2 WHERE id = ?3",
            params![status, result_run_id, id],
        )?;
        Ok(())
    }

    pub fn delete_queued_chat_messages(&self, task_id: &str) -> Result<usize> {
        let conn = self.connect()?;
        let deleted = conn.execute(
            "DELETE FROM chat_messages WHERE task_id = ?1 AND status = 'queued'",
            [task_id],
        )?;
        Ok(deleted)
    }

    pub fn count_queued_chat_messages(&self, task_id: &str) -> Result<i64> {
        let conn = self.connect()?;
        let count: i64 = conn.query_row(
            "SELECT COUNT(*) FROM chat_messages WHERE task_id = ?1 AND status = 'queued'",
            [task_id],
            |row| row.get(0),
        )?;
        Ok(count)
    }
}
