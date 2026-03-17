-- migration: 001_create_sync_storage

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  sync_key_hash TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS entries (
  user_id TEXT NOT NULL,
  id TEXT NOT NULL,
  date TEXT NOT NULL,
  topic TEXT NOT NULL,
  topic_picker TEXT,
  depth TEXT NOT NULL,
  prompt_id TEXT NOT NULL,
  prompt_text TEXT NOT NULL,
  follow_up TEXT,
  mode TEXT NOT NULL CHECK(mode IN ('offline', 'text', 'photo')),
  text TEXT,
  has_photo INTEGER NOT NULL DEFAULT 0,
  photo_key TEXT,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  PRIMARY KEY (user_id, id)
);

CREATE TABLE IF NOT EXISTS change_log (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  entry_id TEXT NOT NULL,
  op TEXT NOT NULL CHECK(op IN ('upsert', 'delete')),
  changed_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_entries_user_date ON entries(user_id, date DESC);
CREATE INDEX IF NOT EXISTS idx_change_log_user_seq ON change_log(user_id, seq);
