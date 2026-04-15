CREATE TABLE mcp_servers (
  id           TEXT PRIMARY KEY,
  catalog_id   TEXT NOT NULL,
  name         TEXT NOT NULL,
  config_json  TEXT NOT NULL,
  enabled      INTEGER NOT NULL DEFAULT 1,
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL
);

CREATE INDEX idx_mcp_servers_catalog ON mcp_servers(catalog_id);

CREATE TABLE agent_profile_mcp (
  agent_profile_id TEXT NOT NULL REFERENCES agent_profiles(id) ON DELETE CASCADE,
  mcp_server_id    TEXT NOT NULL REFERENCES mcp_servers(id)    ON DELETE CASCADE,
  PRIMARY KEY (agent_profile_id, mcp_server_id)
);

CREATE INDEX idx_agent_profile_mcp_profile ON agent_profile_mcp(agent_profile_id);

CREATE TABLE mcp_secrets (
  id            TEXT PRIMARY KEY,
  mcp_server_id TEXT NOT NULL REFERENCES mcp_servers(id) ON DELETE CASCADE,
  env_key       TEXT NOT NULL,
  value_cipher  BLOB NOT NULL,
  UNIQUE (mcp_server_id, env_key)
);
