use anyhow::Result;
use rusqlite::params;
use uuid::Uuid;

use crate::models::RepositoryRule;

use super::{Db, now_iso};

impl Db {
    /// List rules for prompt injection: repo-specific + global rules.
    pub fn list_rules_for_prompt(&self, repo_id: &str) -> Result<Vec<RepositoryRule>> {
        let conn = self.connect()?;
        let mut stmt = conn.prepare(
            "SELECT id, repo_id, content, source, source_comment_id, created_at, updated_at
             FROM repository_rules
             WHERE repo_id = ?1 OR repo_id IS NULL
             ORDER BY created_at ASC",
        )?;
        let rows = stmt.query_map(params![repo_id], |row| {
            Ok(RepositoryRule {
                id: row.get(0)?,
                repo_id: row.get(1)?,
                content: row.get(2)?,
                source: row.get(3)?,
                source_comment_id: row.get(4)?,
                created_at: row.get(5)?,
                updated_at: row.get(6)?,
            })
        })?;
        rows.collect::<std::result::Result<Vec<_>, _>>()
            .map_err(anyhow::Error::from)
    }

    /// List rules for UI. If repo_id is given, returns repo + global. Otherwise global only.
    pub fn list_rules(&self, repo_id: Option<&str>) -> Result<Vec<RepositoryRule>> {
        if let Some(rid) = repo_id {
            self.list_rules_for_prompt(rid)
        } else {
            let conn = self.connect()?;
            let mut stmt = conn.prepare(
                "SELECT id, repo_id, content, source, source_comment_id, created_at, updated_at
                 FROM repository_rules
                 WHERE repo_id IS NULL
                 ORDER BY created_at ASC",
            )?;
            let rows = stmt.query_map([], |row| {
                Ok(RepositoryRule {
                    id: row.get(0)?,
                    repo_id: row.get(1)?,
                    content: row.get(2)?,
                    source: row.get(3)?,
                    source_comment_id: row.get(4)?,
                    created_at: row.get(5)?,
                    updated_at: row.get(6)?,
                })
            })?;
            rows.collect::<std::result::Result<Vec<_>, _>>()
                .map_err(anyhow::Error::from)
        }
    }

    pub fn create_rule(
        &self,
        repo_id: Option<&str>,
        content: &str,
        source: &str,
        source_comment_id: Option<&str>,
    ) -> Result<RepositoryRule> {
        let conn = self.connect()?;
        let id = Uuid::new_v4().to_string();
        let ts = now_iso();
        conn.execute(
            "INSERT INTO repository_rules (id, repo_id, content, source, source_comment_id, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            params![id, repo_id, content, source, source_comment_id, ts, ts],
        )?;
        Ok(RepositoryRule {
            id,
            repo_id: repo_id.map(String::from),
            content: content.to_string(),
            source: source.to_string(),
            source_comment_id: source_comment_id.map(String::from),
            created_at: ts.clone(),
            updated_at: ts,
        })
    }

    pub fn update_rule(&self, id: &str, content: &str) -> Result<()> {
        let conn = self.connect()?;
        let ts = now_iso();
        let n = conn.execute(
            "UPDATE repository_rules SET content = ?1, updated_at = ?2 WHERE id = ?3",
            params![content, ts, id],
        )?;
        if n == 0 {
            return Err(anyhow::anyhow!("Rule not found"));
        }
        Ok(())
    }

    pub fn delete_rule(&self, id: &str) -> Result<()> {
        let conn = self.connect()?;
        conn.execute("DELETE FROM repository_rules WHERE id = ?1", [id])?;
        Ok(())
    }

    pub fn get_rule_by_id(&self, id: &str) -> Result<Option<RepositoryRule>> {
        let conn = self.connect()?;
        conn.query_row(
            "SELECT id, repo_id, content, source, source_comment_id, created_at, updated_at
             FROM repository_rules WHERE id = ?1",
            [id],
            |row| {
                Ok(RepositoryRule {
                    id: row.get(0)?,
                    repo_id: row.get(1)?,
                    content: row.get(2)?,
                    source: row.get(3)?,
                    source_comment_id: row.get(4)?,
                    created_at: row.get(5)?,
                    updated_at: row.get(6)?,
                })
            },
        )
        .optional()
        .map_err(anyhow::Error::from)
    }

    /// Bulk replace rules for a given scope (repo_id or global).
    /// Deletes existing rules for that scope and inserts new ones.
    pub fn bulk_replace_rules(
        &self,
        repo_id: Option<&str>,
        contents: &[String],
    ) -> Result<Vec<RepositoryRule>> {
        let mut conn = self.connect()?;
        let tx = conn.transaction()?;
        let ts = now_iso();

        if let Some(rid) = repo_id {
            tx.execute(
                "DELETE FROM repository_rules WHERE repo_id = ?1",
                params![rid],
            )?;
        } else {
            tx.execute(
                "DELETE FROM repository_rules WHERE repo_id IS NULL",
                [],
            )?;
        }

        let mut result = Vec::with_capacity(contents.len());
        for content in contents {
            let id = Uuid::new_v4().to_string();
            tx.execute(
                "INSERT INTO repository_rules (id, repo_id, content, source, source_comment_id, created_at, updated_at)
                 VALUES (?1, ?2, ?3, 'manual', NULL, ?4, ?5)",
                params![id, repo_id, content, ts, ts],
            )?;
            result.push(RepositoryRule {
                id,
                repo_id: repo_id.map(String::from),
                content: content.clone(),
                source: "manual".to_string(),
                source_comment_id: None,
                created_at: ts.clone(),
                updated_at: ts.clone(),
            });
        }

        tx.commit()?;
        Ok(result)
    }
}

use rusqlite::OptionalExtension;
