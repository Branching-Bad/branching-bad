use rusqlite::OptionalExtension;
use anyhow::{Context, Result};
use rusqlite::params;
use uuid::Uuid;
use serde_json::Value;

use crate::models::{ProviderAccountRow, ProviderResourceRow, ProviderBindingRow, ProviderItemRow};

use super::{Db, now_iso};

impl Db {
    pub fn upsert_provider_account(
        &self,
        provider_id: &str,
        config: &Value,
        display_name: &str,
    ) -> Result<ProviderAccountRow> {
        let config_json = config.to_string();
        let conn = self.connect()?;
        let ts = now_iso();

        let existing_id: Option<String> = conn
            .query_row(
                "SELECT id FROM provider_accounts WHERE provider_id = ?1 AND display_name = ?2",
                params![provider_id, display_name],
                |row| row.get(0),
            )
            .optional()?;

        if let Some(id) = existing_id {
            conn.execute(
                "UPDATE provider_accounts SET config_json = ?1, updated_at = ?2 WHERE id = ?3",
                params![config_json, ts, id],
            )?;
            return self
                .get_provider_account(&id)?
                .context("provider account not found after update");
        }

        let id = Uuid::new_v4().to_string();
        conn.execute(
            "INSERT INTO provider_accounts (id, provider_id, config_json, display_name, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![id, provider_id, config_json, display_name, ts, ts],
        )?;
        self.get_provider_account(&id)?
            .context("provider account missing after insert")
    }

    pub fn list_provider_accounts(&self, provider_id: &str) -> Result<Vec<ProviderAccountRow>> {
        let conn = self.connect()?;
        let mut stmt = conn.prepare(
            "SELECT id, provider_id, config_json, display_name, created_at, updated_at FROM provider_accounts WHERE provider_id = ?1 ORDER BY updated_at DESC",
        )?;
        let rows = stmt.query_map([provider_id], |row| {
            Ok(ProviderAccountRow {
                id: row.get(0)?,
                provider_id: row.get(1)?,
                config_json: row.get(2)?,
                display_name: row.get(3)?,
                created_at: row.get(4)?,
                updated_at: row.get(5)?,
            })
        })?;
        rows.collect::<std::result::Result<Vec<_>, _>>()
            .map_err(anyhow::Error::from)
    }

    pub fn get_provider_account(&self, id: &str) -> Result<Option<ProviderAccountRow>> {
        let conn = self.connect()?;
        conn.query_row(
            "SELECT id, provider_id, config_json, display_name, created_at, updated_at FROM provider_accounts WHERE id = ?1",
            [id],
            |row| {
                Ok(ProviderAccountRow {
                    id: row.get(0)?,
                    provider_id: row.get(1)?,
                    config_json: row.get(2)?,
                    display_name: row.get(3)?,
                    created_at: row.get(4)?,
                    updated_at: row.get(5)?,
                })
            },
        )
        .optional()
        .map_err(anyhow::Error::from)
    }

    pub fn delete_provider_account(&self, id: &str) -> Result<()> {
        let conn = self.connect()?;
        conn.execute("DELETE FROM provider_accounts WHERE id = ?1", [id])?;
        Ok(())
    }

    pub fn upsert_provider_resources(
        &self,
        provider_account_id: &str,
        provider_id: &str,
        resources: &[(String, String, String)], // (external_id, name, extra_json)
    ) -> Result<()> {
        let mut conn = self.connect()?;
        let tx = conn.transaction()?;
        let ts = now_iso();

        for (external_id, name, extra_json) in resources {
            let existing_id: Option<String> = tx
                .query_row(
                    "SELECT id FROM provider_resources WHERE provider_account_id = ?1 AND external_id = ?2",
                    params![provider_account_id, external_id],
                    |row| row.get(0),
                )
                .optional()?;
            let id = existing_id.unwrap_or_else(|| Uuid::new_v4().to_string());
            tx.execute(
                r#"INSERT INTO provider_resources (id, provider_account_id, provider_id, external_id, name, extra_json, created_at, updated_at)
                   VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
                   ON CONFLICT(provider_account_id, external_id)
                   DO UPDATE SET name = excluded.name, extra_json = excluded.extra_json, updated_at = excluded.updated_at"#,
                params![id, provider_account_id, provider_id, external_id, name, extra_json, ts, ts],
            )?;
        }
        tx.commit()?;
        Ok(())
    }

    pub fn list_provider_resources(&self, provider_account_id: &str) -> Result<Vec<ProviderResourceRow>> {
        let conn = self.connect()?;
        let mut stmt = conn.prepare(
            "SELECT id, provider_account_id, provider_id, external_id, name, extra_json, created_at, updated_at FROM provider_resources WHERE provider_account_id = ?1 ORDER BY name ASC",
        )?;
        let rows = stmt.query_map([provider_account_id], |row| {
            Ok(ProviderResourceRow {
                id: row.get(0)?,
                provider_account_id: row.get(1)?,
                provider_id: row.get(2)?,
                external_id: row.get(3)?,
                name: row.get(4)?,
                extra_json: row.get(5)?,
                created_at: row.get(6)?,
                updated_at: row.get(7)?,
            })
        })?;
        rows.collect::<std::result::Result<Vec<_>, _>>()
            .map_err(anyhow::Error::from)
    }

    pub fn get_provider_resource(&self, id: &str) -> Result<Option<ProviderResourceRow>> {
        let conn = self.connect()?;
        conn.query_row(
            "SELECT id, provider_account_id, provider_id, external_id, name, extra_json, created_at, updated_at FROM provider_resources WHERE id = ?1",
            [id],
            |row| {
                Ok(ProviderResourceRow {
                    id: row.get(0)?,
                    provider_account_id: row.get(1)?,
                    provider_id: row.get(2)?,
                    external_id: row.get(3)?,
                    name: row.get(4)?,
                    extra_json: row.get(5)?,
                    created_at: row.get(6)?,
                    updated_at: row.get(7)?,
                })
            },
        )
        .optional()
        .map_err(anyhow::Error::from)
    }

    pub fn create_provider_binding(
        &self,
        repo_id: &str,
        account_id: &str,
        resource_id: &str,
        provider_id: &str,
        config_json: &str,
    ) -> Result<ProviderBindingRow> {
        let conn = self.connect()?;
        let ts = now_iso();
        conn.execute(
            r#"INSERT INTO provider_bindings (repo_id, provider_account_id, provider_resource_id, provider_id, config_json, created_at, updated_at)
               VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
               ON CONFLICT(repo_id, provider_account_id, provider_resource_id)
               DO UPDATE SET config_json = excluded.config_json, updated_at = excluded.updated_at"#,
            params![repo_id, account_id, resource_id, provider_id, config_json, ts, ts],
        )?;
        Ok(ProviderBindingRow {
            repo_id: repo_id.to_string(),
            provider_account_id: account_id.to_string(),
            provider_resource_id: resource_id.to_string(),
            provider_id: provider_id.to_string(),
            config_json: config_json.to_string(),
            created_at: ts.clone(),
            updated_at: ts,
        })
    }

    pub fn list_provider_bindings(&self, provider_id: &str) -> Result<Vec<ProviderBindingRow>> {
        let conn = self.connect()?;
        let mut stmt = conn.prepare(
            "SELECT repo_id, provider_account_id, provider_resource_id, provider_id, config_json, created_at, updated_at FROM provider_bindings WHERE provider_id = ?1",
        )?;
        let rows = stmt.query_map([provider_id], |row| {
            Ok(ProviderBindingRow {
                repo_id: row.get(0)?,
                provider_account_id: row.get(1)?,
                provider_resource_id: row.get(2)?,
                provider_id: row.get(3)?,
                config_json: row.get(4)?,
                created_at: row.get(5)?,
                updated_at: row.get(6)?,
            })
        })?;
        rows.collect::<std::result::Result<Vec<_>, _>>()
            .map_err(anyhow::Error::from)
    }

    pub fn list_provider_bindings_for_repo(&self, repo_id: &str) -> Result<Vec<ProviderBindingRow>> {
        let conn = self.connect()?;
        let mut stmt = conn.prepare(
            "SELECT repo_id, provider_account_id, provider_resource_id, provider_id, config_json, created_at, updated_at FROM provider_bindings WHERE repo_id = ?1",
        )?;
        let rows = stmt.query_map([repo_id], |row| {
            Ok(ProviderBindingRow {
                repo_id: row.get(0)?,
                provider_account_id: row.get(1)?,
                provider_resource_id: row.get(2)?,
                provider_id: row.get(3)?,
                config_json: row.get(4)?,
                created_at: row.get(5)?,
                updated_at: row.get(6)?,
            })
        })?;
        rows.collect::<std::result::Result<Vec<_>, _>>()
            .map_err(anyhow::Error::from)
    }

    pub fn upsert_provider_items(
        &self,
        provider_account_id: &str,
        provider_resource_id: &str,
        provider_id: &str,
        items: &[(String, String, String)], // (external_id, title, data_json)
    ) -> Result<usize> {
        let mut conn = self.connect()?;
        let tx = conn.transaction()?;
        let ts = now_iso();
        let mut upserted = 0;

        for (external_id, title, data_json) in items {
            let existing: Option<(String, String, Option<String>)> = tx
                .query_row(
                    "SELECT id, status, linked_task_id FROM provider_items WHERE provider_account_id = ?1 AND external_id = ?2",
                    params![provider_account_id, external_id],
                    |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
                )
                .optional()?;

            if let Some((existing_id, current_status, linked_task_id)) = existing {
                let mut new_status = current_status;
                if let Some(ref task_id) = linked_task_id {
                    let task_status: Option<String> = tx
                        .query_row(
                            "SELECT status FROM tasks WHERE id = ?1",
                            [task_id],
                            |row| row.get(0),
                        )
                        .optional()?;
                    if let Some(ref s) = task_status {
                        if s == "DONE" || s == "done" {
                            new_status = "regression".to_string();
                        }
                    }
                }

                tx.execute(
                    r#"UPDATE provider_items SET
                        title = ?1, data_json = ?2, status = ?3, updated_at = ?4
                       WHERE id = ?5"#,
                    params![title, data_json, new_status, ts, existing_id],
                )?;
            } else {
                let id = Uuid::new_v4().to_string();
                tx.execute(
                    r#"INSERT INTO provider_items (
                        id, provider_account_id, provider_resource_id, provider_id,
                        external_id, title, status, linked_task_id, data_json,
                        created_at, updated_at
                    ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'pending', NULL, ?7, ?8, ?9)"#,
                    params![
                        id, provider_account_id, provider_resource_id, provider_id,
                        external_id, title, data_json, ts, ts
                    ],
                )?;
            }
            upserted += 1;
        }
        tx.commit()?;
        Ok(upserted)
    }

    pub fn list_provider_items(
        &self,
        repo_id: &str,
        provider_id: &str,
        status_filter: Option<&str>,
    ) -> Result<Vec<ProviderItemRow>> {
        let conn = self.connect()?;
        let sql = if let Some(status) = status_filter {
            format!(
                r#"SELECT pi.id, pi.provider_account_id, pi.provider_resource_id, pi.provider_id,
                    pi.external_id, pi.title, pi.status, pi.linked_task_id, pi.data_json,
                    pi.created_at, pi.updated_at
                   FROM provider_items pi
                   INNER JOIN provider_bindings pb
                     ON pi.provider_account_id = pb.provider_account_id
                     AND pi.provider_resource_id = pb.provider_resource_id
                   WHERE pb.repo_id = ?1 AND pi.provider_id = ?2 AND pi.status = '{}'
                   ORDER BY pi.updated_at DESC"#,
                status.replace('\'', "''")
            )
        } else {
            r#"SELECT pi.id, pi.provider_account_id, pi.provider_resource_id, pi.provider_id,
                pi.external_id, pi.title, pi.status, pi.linked_task_id, pi.data_json,
                pi.created_at, pi.updated_at
               FROM provider_items pi
               INNER JOIN provider_bindings pb
                 ON pi.provider_account_id = pb.provider_account_id
                 AND pi.provider_resource_id = pb.provider_resource_id
               WHERE pb.repo_id = ?1 AND pi.provider_id = ?2
               ORDER BY pi.updated_at DESC"#
                .to_string()
        };
        let mut stmt = conn.prepare(&sql)?;
        let rows = stmt.query_map(params![repo_id, provider_id], |row| {
            Ok(ProviderItemRow {
                id: row.get(0)?,
                provider_account_id: row.get(1)?,
                provider_resource_id: row.get(2)?,
                provider_id: row.get(3)?,
                external_id: row.get(4)?,
                title: row.get(5)?,
                status: row.get(6)?,
                linked_task_id: row.get(7)?,
                data_json: row.get(8)?,
                created_at: row.get(9)?,
                updated_at: row.get(10)?,
            })
        })?;
        rows.collect::<std::result::Result<Vec<_>, _>>()
            .map_err(anyhow::Error::from)
    }

    pub fn get_provider_item(&self, id: &str) -> Result<Option<ProviderItemRow>> {
        let conn = self.connect()?;
        conn.query_row(
            r#"SELECT id, provider_account_id, provider_resource_id, provider_id,
                external_id, title, status, linked_task_id, data_json,
                created_at, updated_at
               FROM provider_items WHERE id = ?1"#,
            [id],
            |row| {
                Ok(ProviderItemRow {
                    id: row.get(0)?,
                    provider_account_id: row.get(1)?,
                    provider_resource_id: row.get(2)?,
                    provider_id: row.get(3)?,
                    external_id: row.get(4)?,
                    title: row.get(5)?,
                    status: row.get(6)?,
                    linked_task_id: row.get(7)?,
                    data_json: row.get(8)?,
                    created_at: row.get(9)?,
                    updated_at: row.get(10)?,
                })
            },
        )
        .optional()
        .map_err(anyhow::Error::from)
    }

    pub fn update_provider_item_status(&self, id: &str, status: &str) -> Result<()> {
        let conn = self.connect()?;
        let ts = now_iso();
        conn.execute(
            "UPDATE provider_items SET status = ?1, updated_at = ?2 WHERE id = ?3",
            params![status, ts, id],
        )?;
        Ok(())
    }

    pub fn delete_provider_items_for_repo(&self, provider_id: &str, repo_id: &str) -> Result<usize> {
        let conn = self.connect()?;
        let count = conn.execute(
            r#"DELETE FROM provider_items
               WHERE provider_id = ?1
                 AND provider_resource_id IN (
                   SELECT pr.id FROM provider_resources pr
                   JOIN provider_bindings pb ON pb.provider_resource_id = pr.id
                   WHERE pb.repo_id = ?2 AND pb.provider_id = ?1
                 )"#,
            params![provider_id, repo_id],
        )?;
        Ok(count)
    }

    pub fn link_provider_item_to_task(&self, item_id: &str, task_id: &str) -> Result<()> {
        let conn = self.connect()?;
        let ts = now_iso();
        conn.execute(
            "UPDATE provider_items SET linked_task_id = ?1, status = 'accepted', updated_at = ?2 WHERE id = ?3",
            params![task_id, ts, item_id],
        )?;
        Ok(())
    }

    pub fn count_all_pending_provider_items(&self) -> Result<std::collections::HashMap<String, i64>> {
        let conn = self.connect()?;
        let mut stmt = conn.prepare(
            "SELECT provider_id, COUNT(*) FROM provider_items WHERE status IN ('pending', 'regression') GROUP BY provider_id",
        )?;
        let mut map = std::collections::HashMap::new();
        let rows = stmt.query_map([], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?))
        })?;
        for row in rows {
            let (pid, count) = row?;
            map.insert(pid, count);
        }
        Ok(map)
    }

    pub fn get_last_provider_sync_time(
        &self,
        provider_account_id: &str,
        provider_resource_id: &str,
    ) -> Result<Option<String>> {
        let conn = self.connect()?;
        conn.query_row(
            "SELECT MAX(updated_at) FROM provider_items WHERE provider_account_id = ?1 AND provider_resource_id = ?2",
            params![provider_account_id, provider_resource_id],
            |row| row.get(0),
        )
        .optional()
        .map(|opt: Option<Option<String>>| opt.flatten())
        .map_err(anyhow::Error::from)
    }
}
