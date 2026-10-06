-- Provider jobs are resumable; credentials and signed URLs are encrypted.
CREATE TABLE parser_jobs (
 id TEXT PRIMARY KEY,
 fingerprint TEXT NOT NULL,
 provider TEXT NOT NULL,
 state TEXT NOT NULL,
 payload TEXT NOT NULL,
 updated_at INTEGER NOT NULL
);
