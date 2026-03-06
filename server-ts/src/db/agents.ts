import { v4 as uuidv4 } from 'uuid';
import type {
  AgentProfile,
  AgentProfileWithMetadata,
  DiscoveredProfile,
  RepoAgentPreference,
} from '../models.js';
import { Db, nowIso } from './index.js';

declare module './index.js' {
  interface Db {
    upsertAgentProfiles(profiles: DiscoveredProfile[]): number;
    listAgentProfiles(): AgentProfileWithMetadata[];
    getAgentProfileById(profileId: string): AgentProfile | null;
    setRepoAgentPreference(repoId: string, agentProfileId: string): RepoAgentPreference;
    getRepoAgentPreference(repoId: string): RepoAgentPreference | null;
  }
}

Db.prototype.upsertAgentProfiles = function (profiles: DiscoveredProfile[]): number {
  if (profiles.length === 0) return 0;

  const db = this.connect();
    const ts = nowIso();
    const tx = this.transaction(() => {
      for (const profile of profiles) {
        const existing = db
          .prepare(
            'SELECT id FROM agent_profiles WHERE provider = ? AND agent_name = ? AND model = ? AND command = ? AND source = ?',
          )
          .get(
            profile.provider,
            profile.agent_name,
            profile.model,
            profile.command,
            profile.source,
          ) as { id: string } | undefined;

        const id = existing?.id ?? uuidv4();

        db.prepare(
          `INSERT INTO agent_profiles (
             id, provider, agent_name, model, command, source, discovery_kind, metadata_json, created_at, updated_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(provider, agent_name, model, command, source)
           DO UPDATE SET discovery_kind = excluded.discovery_kind,
                         metadata_json = excluded.metadata_json,
                         updated_at = excluded.updated_at`,
        ).run(
          id,
          profile.provider,
          profile.agent_name,
          profile.model,
          profile.command,
          profile.source,
          profile.discovery_kind,
          JSON.stringify(profile.metadata ?? {}),
          ts,
          ts,
        );
      }
    });
    tx();

    return profiles.length;
};

Db.prototype.listAgentProfiles = function (): AgentProfileWithMetadata[] {
  const db = this.connect();
    const rows = db
      .prepare(
        'SELECT id, provider, agent_name, model, command, source, discovery_kind, metadata_json, created_at, updated_at FROM agent_profiles ORDER BY provider ASC, agent_name ASC, model ASC, updated_at DESC',
      )
      .all() as any[];
    return rows.map((row) => ({
      id: row.id,
      provider: row.provider,
      agent_name: row.agent_name,
      model: row.model,
      command: row.command,
      source: row.source,
      discovery_kind: row.discovery_kind,
      metadata: JSON.parse(row.metadata_json || '{}'),
      created_at: row.created_at,
      updated_at: row.updated_at,
    }));
};

Db.prototype.getAgentProfileById = function (profileId: string): AgentProfile | null {
  const db = this.connect();
    const row = db
      .prepare(
        'SELECT id, provider, agent_name, model, command, source, discovery_kind, metadata_json, created_at, updated_at FROM agent_profiles WHERE id = ?',
      )
      .get(profileId) as any | undefined;
    return row
      ? {
          id: row.id,
          provider: row.provider,
          agent_name: row.agent_name,
          model: row.model,
          command: row.command,
          source: row.source,
          discovery_kind: row.discovery_kind,
          metadata_json: row.metadata_json,
          created_at: row.created_at,
          updated_at: row.updated_at,
        }
      : null;
};

Db.prototype.setRepoAgentPreference = function (
  repoId: string,
  agentProfileId: string,
): RepoAgentPreference {
  const db = this.connect();
    const ts = nowIso();
    db.prepare(
      `INSERT INTO repo_agent_preferences (repo_id, agent_profile_id, created_at, updated_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(repo_id)
       DO UPDATE SET agent_profile_id = excluded.agent_profile_id, updated_at = excluded.updated_at`,
    ).run(repoId, agentProfileId, ts, ts);

    const row = db
      .prepare(
        'SELECT repo_id, agent_profile_id, created_at, updated_at FROM repo_agent_preferences WHERE repo_id = ?',
      )
      .get(repoId) as any;
    return row as RepoAgentPreference;
};

Db.prototype.getRepoAgentPreference = function (
  repoId: string,
): RepoAgentPreference | null {
  const db = this.connect();
    const row = db
      .prepare(
        'SELECT repo_id, agent_profile_id, created_at, updated_at FROM repo_agent_preferences WHERE repo_id = ?',
      )
      .get(repoId) as any | undefined;
    return row ? (row as RepoAgentPreference) : null;
};
