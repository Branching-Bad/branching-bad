use rusqlite::OptionalExtension;
use anyhow::{Context, Result};
use rusqlite::params;
use uuid::Uuid;

use crate::models::Repo;

use super::{Db, now_iso};

impl Db {
    pub fn create_or_update_repo(&self, path: &str, name: Option<&str>) -> Result<Repo> {
        let conn = self.connect()?;
        let existing: Option<Repo> = conn
            .query_row(
                "SELECT id, name, path, created_at, updated_at FROM repos WHERE path = ?1",
                [path],
                |row| {
                    Ok(Repo {
                        id: row.get(0)?,
                        name: row.get(1)?,
                        path: row.get(2)?,
                        created_at: row.get(3)?,
                        updated_at: row.get(4)?,
                    })
                },
            )
            .optional()?;
        let ts = now_iso();

        if let Some(repo) = existing {
            let updated_name = name.unwrap_or(repo.name.as_str()).to_string();
            conn.execute(
                "UPDATE repos SET name = ?1, updated_at = ?2 WHERE id = ?3",
                params![updated_name, ts, repo.id],
            )?;
            return self
                .get_repo_by_id(&repo.id)?
                .context("repo not found after update");
        }

        let repo = Repo {
            id: Uuid::new_v4().to_string(),
            name: name
                .map(ToString::to_string)
                .filter(|s| !s.trim().is_empty())
                .unwrap_or_else(|| {
                    std::path::Path::new(path)
                        .file_name()
                        .map(|s| s.to_string_lossy().to_string())
                        .unwrap_or_else(|| "repo".to_string())
                }),
            path: path.to_string(),
            created_at: ts.clone(),
            updated_at: ts,
        };
        conn.execute(
            "INSERT INTO repos (id, name, path, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5)",
            params![repo.id, repo.name, repo.path, repo.created_at, repo.updated_at],
        )?;
        Ok(repo)
    }

    pub fn list_repos(&self) -> Result<Vec<Repo>> {
        let conn = self.connect()?;
        let mut stmt =
            conn.prepare("SELECT id, name, path, created_at, updated_at FROM repos ORDER BY updated_at DESC")?;
        let rows = stmt.query_map([], |row| {
            Ok(Repo {
                id: row.get(0)?,
                name: row.get(1)?,
                path: row.get(2)?,
                created_at: row.get(3)?,
                updated_at: row.get(4)?,
            })
        })?;
        rows.collect::<std::result::Result<Vec<_>, _>>()
            .map_err(anyhow::Error::from)
    }

    pub fn get_repo_by_id(&self, id: &str) -> Result<Option<Repo>> {
        let conn = self.connect()?;
        conn.query_row(
            "SELECT id, name, path, created_at, updated_at FROM repos WHERE id = ?1",
            [id],
            |row| {
                Ok(Repo {
                    id: row.get(0)?,
                    name: row.get(1)?,
                    path: row.get(2)?,
                    created_at: row.get(3)?,
                    updated_at: row.get(4)?,
                })
            },
        )
        .optional()
        .map_err(anyhow::Error::from)
    }
}
