CREATE TABLE files (
  path TEXT PRIMARY KEY,
  version INTEGER NOT NULL,
  seq INTEGER NOT NULL,
  mutation_id TEXT NOT NULL,
  deleted INTEGER NOT NULL DEFAULT 0,
  content TEXT,
  blob_key TEXT,
  mime TEXT NOT NULL,
  size INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX files_seq ON files(seq);
CREATE TABLE clock (id INTEGER PRIMARY KEY CHECK(id = 1), value INTEGER NOT NULL);
INSERT INTO clock VALUES (1, 0);
CREATE TABLE config (id INTEGER PRIMARY KEY CHECK(id = 1), value TEXT NOT NULL);
CREATE TABLE workspace (id INTEGER PRIMARY KEY CHECK(id = 1), uuid TEXT NOT NULL);
INSERT INTO workspace VALUES (1, lower(hex(randomblob(16))));
