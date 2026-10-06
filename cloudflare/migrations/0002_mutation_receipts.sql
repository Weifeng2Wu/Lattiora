-- Keep acknowledgements beyond the latest file version. A device can retry a
-- successful write after another device has already changed that same file.
CREATE TABLE mutation_receipts (
  mutation_id TEXT PRIMARY KEY,
  request_hash TEXT NOT NULL,
  result TEXT NOT NULL
);
