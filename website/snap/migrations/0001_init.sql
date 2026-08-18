PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS repository_versions (
  name TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  frozen INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS upstreams (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  api_url TEXT NOT NULL UNIQUE,
  kind TEXT NOT NULL DEFAULT 'snap-store',
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS version_upstreams (
  version_name TEXT NOT NULL REFERENCES repository_versions(name) ON DELETE CASCADE,
  upstream_id INTEGER NOT NULL REFERENCES upstreams(id) ON DELETE CASCADE,
  priority INTEGER NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (version_name, upstream_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS version_upstream_priority ON version_upstreams(version_name, priority);

CREATE TABLE IF NOT EXISTS apps (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  display_name TEXT NOT NULL,
  publisher TEXT NOT NULL,
  summary TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  category TEXT NOT NULL DEFAULT 'Utilities',
  icon_url TEXT,
  accent TEXT NOT NULL DEFAULT '#2563eb',
  verified INTEGER NOT NULL DEFAULT 0,
  featured INTEGER NOT NULL DEFAULT 0,
  webdesktop_mode TEXT NOT NULL DEFAULT 'unknown',
  hidden INTEGER NOT NULL DEFAULT 0,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS snap_revisions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  app_id TEXT NOT NULL REFERENCES apps(id) ON DELETE CASCADE,
  repository_version TEXT NOT NULL REFERENCES repository_versions(name) ON DELETE CASCADE,
  snap_version TEXT NOT NULL,
  revision TEXT NOT NULL,
  architecture TEXT NOT NULL,
  channel TEXT NOT NULL DEFAULT 'stable',
  object_path TEXT NOT NULL,
  sha3_384 TEXT,
  size INTEGER NOT NULL DEFAULT 0,
  published INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(app_id, repository_version, revision, architecture)
);

CREATE TABLE IF NOT EXISTS admin_sessions (
  token_hash TEXT PRIMARY KEY,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  ip TEXT
);

CREATE TABLE IF NOT EXISTS login_failures (
  ip TEXT PRIMARY KEY,
  attempts INTEGER NOT NULL DEFAULT 0,
  window_start INTEGER NOT NULL,
  locked_until INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  action TEXT NOT NULL,
  detail_json TEXT NOT NULL DEFAULT '{}',
  ip TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT OR IGNORE INTO repository_versions(name,label,active,frozen) VALUES ('rolling','Rolling',1,0);
INSERT OR IGNORE INTO upstreams(id,name,api_url,kind,enabled) VALUES (1,'Canonical Snap Store','https://api.snapcraft.io','canonical',1);
INSERT OR IGNORE INTO version_upstreams(version_name,upstream_id,priority,enabled) VALUES ('rolling',1,10,1);
