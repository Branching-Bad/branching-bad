CREATE TABLE IF NOT EXISTS ssh_groups (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS ssh_connections (
  id TEXT PRIMARY KEY,
  alias TEXT NOT NULL UNIQUE,
  group_id TEXT REFERENCES ssh_groups(id) ON DELETE SET NULL,
  host TEXT NOT NULL,
  port INTEGER NOT NULL DEFAULT 22,
  username TEXT NOT NULL,
  auth_type TEXT NOT NULL CHECK (auth_type IN ('password', 'key')),
  key_path TEXT,
  password_cipher TEXT,
  has_passphrase INTEGER NOT NULL DEFAULT 0,
  passphrase_cipher TEXT,
  jump_host_id TEXT REFERENCES ssh_connections(id) ON DELETE SET NULL,
  last_connected_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS ssh_forwards (
  id TEXT PRIMARY KEY,
  connection_id TEXT NOT NULL REFERENCES ssh_connections(id) ON DELETE CASCADE,
  forward_type TEXT NOT NULL CHECK (forward_type IN ('local', 'remote')),
  bind_address TEXT NOT NULL DEFAULT '127.0.0.1',
  bind_port INTEGER NOT NULL,
  remote_host TEXT NOT NULL,
  remote_port INTEGER NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_ssh_forwards_conn ON ssh_forwards(connection_id);

CREATE TABLE IF NOT EXISTS ssh_host_keys (
  host TEXT NOT NULL,
  port INTEGER NOT NULL,
  fingerprint TEXT NOT NULL,
  approved_at TEXT NOT NULL,
  PRIMARY KEY (host, port)
);

CREATE TABLE IF NOT EXISTS ssh_history (
  id TEXT PRIMARY KEY,
  connection_id TEXT NOT NULL,
  attempted_at TEXT NOT NULL,
  status TEXT NOT NULL,
  error_code TEXT,
  duration_sec INTEGER
);

CREATE INDEX IF NOT EXISTS idx_ssh_history_conn ON ssh_history(connection_id, attempted_at DESC);

CREATE TABLE IF NOT EXISTS ssh_kv (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
