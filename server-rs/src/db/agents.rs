use rusqlite::OptionalExtension;
use anyhow::{Context, Result};
use rusqlite::params;
use serde_json::json;
use uuid::Uuid;

use crate::models::{AgentProfile, AgentProfileWithMetadata, DiscoveredProfile, RepoAgentPreference};

use super::{Db, now_iso};

impl Db {
    pub fn upsert_agent_profiles(&self, profiles: &[DiscoveredProfile]) -> Result<usize> {
        if profiles.is_empty() {
            return Ok(0);
        }
        let mut conn = self.connect()?;
        let tx = conn.transaction()?;
        let ts = now_iso();

        for profile in profiles {
            let existing_id: Option<String> = tx
                .query_row(
                    "SELECT id FROM agent_profiles WHERE provider = ?1 AND agent_name = ?2 AND model = ?3 AND command = ?4 AND source = ?5",
                    params![profile.provider, profile.agent_name, profile.model, profile.command, profile.source],
                    |row| row.get(0),
                )
                .optional()?;
            let id = existing_id.unwrap_or_else(|| Uuid::new_v4().to_string());
            tx.execute(
                r#"INSERT INTO agent_profiles (
                     id, provider, agent_name, model, command, source, discovery_kind, metadata_json, created_at, updated_at
                   ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)
                   ON CONFLICT(provider, agent_name, model, command, source)
                   DO UPDATE SET discovery_kind = excluded.discovery_kind,
                                 metadata_json = excluded.metadata_json,
                                 updated_at = excluded.updated_at"#,
                params![
                    id,
                    profile.provider,
                    profile.agent_name,
                    profile.model,
                    profile.command,
                    profile.source,
                    profile.discovery_kind,
                    profile.metadata.to_string(),
                    ts,
                    ts
                ],
            )?;
        }
        tx.commit()?;
        Ok(profiles.len())
    }

    pub fn list_agent_profiles(&self) -> Result<Vec<AgentProfileWithMetadata>> {
        let conn = self.connect()?;
        let mut stmt = conn.prepare(
            "SELECT id, provider, agent_name, model, command, source, discovery_kind, metadata_json, created_at, updated_at FROM agent_profiles ORDER BY provider ASC, agent_name ASC, model ASC, updated_at DESC",
        )?;
        let rows = stmt.query_map([], |row| {
            let metadata_raw: String = row.get(7)?;
            Ok(AgentProfileWithMetadata {
                id: row.get(0)?,
                provider: row.get(1)?,
                agent_name: row.get(2)?,
                model: row.get(3)?,
                command: row.get(4)?,
                source: row.get(5)?,
                discovery_kind: row.get(6)?,
                metadata: serde_json::from_str(&metadata_raw).unwrap_or_else(|_| json!({})),
                created_at: row.get(8)?,
                updated_at: row.get(9)?,
            })
        })?;
        rows.collect::<std::result::Result<Vec<_>, _>>()
            .map_err(anyhow::Error::from)
    }

    pub fn get_agent_profile_by_id(&self, profile_id: &str) -> Result<Option<AgentProfile>> {
        let conn = self.connect()?;
        conn.query_row(
            "SELECT id, provider, agent_name, model, command, source, discovery_kind, metadata_json, created_at, updated_at FROM agent_profiles WHERE id = ?1",
            [profile_id],
            |row| {
                Ok(AgentProfile {
                    id: row.get(0)?,
                    provider: row.get(1)?,
                    agent_name: row.get(2)?,
                    model: row.get(3)?,
                    command: row.get(4)?,
                    source: row.get(5)?,
                    discovery_kind: row.get(6)?,
                    metadata_json: row.get(7)?,
                    created_at: row.get(8)?,
                    updated_at: row.get(9)?,
                })
            },
        )
        .optional()
        .map_err(anyhow::Error::from)
    }

    pub fn set_repo_agent_preference(
        &self,
        repo_id: &str,
        agent_profile_id: &str,
    ) -> Result<RepoAgentPreference> {
        let conn = self.connect()?;
        let ts = now_iso();
        conn.execute(
            r#"INSERT INTO repo_agent_preferences (repo_id, agent_profile_id, created_at, updated_at)
               VALUES (?1, ?2, ?3, ?4)
               ON CONFLICT(repo_id)
               DO UPDATE SET agent_profile_id = excluded.agent_profile_id, updated_at = excluded.updated_at"#,
            params![repo_id, agent_profile_id, ts, ts],
        )?;
        self.get_repo_agent_preference(repo_id)?
            .context("repo preference missing after upsert")
    }

    pub fn get_repo_agent_preference(&self, repo_id: &str) -> Result<Option<RepoAgentPreference>> {
        let conn = self.connect()?;
        conn.query_row(
            "SELECT repo_id, agent_profile_id, created_at, updated_at FROM repo_agent_preferences WHERE repo_id = ?1",
            [repo_id],
            |row| {
                Ok(RepoAgentPreference {
                    repo_id: row.get(0)?,
                    agent_profile_id: row.get(1)?,
                    created_at: row.get(2)?,
                    updated_at: row.get(3)?,
                })
            },
        )
        .optional()
        .map_err(anyhow::Error::from)
    }
}
