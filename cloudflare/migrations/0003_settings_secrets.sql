CREATE TABLE settings_secrets (
  name TEXT PRIMARY KEY,
  version INTEGER NOT NULL,
  value TEXT NOT NULL,
  configured INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
