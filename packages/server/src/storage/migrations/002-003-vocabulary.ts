// Frozen historical discovery migrations. Never import live feature schemas here.
export const SPEECH_VOCABULARY_SCHEMA = `
CREATE TABLE speech_vocabulary_state (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  generation INTEGER NOT NULL DEFAULT 0,
  enabled INTEGER NOT NULL DEFAULT 0,
  biasing INTEGER NOT NULL DEFAULT 0,
  hours REAL NOT NULL DEFAULT 24,
  reset_after REAL NOT NULL DEFAULT 0
);
INSERT INTO speech_vocabulary_state (id) VALUES (1);
CREATE TABLE speech_words (
  word TEXT PRIMARY KEY,
  user_count INTEGER NOT NULL CHECK (user_count >= 0),
  assistant_count INTEGER NOT NULL CHECK (assistant_count >= 0)
) WITHOUT ROWID;
CREATE TABLE speech_messages (
  session_key TEXT NOT NULL,
  fingerprint TEXT NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('user', 'assistant')),
  timestamp REAL NOT NULL,
  counts TEXT NOT NULL,
  PRIMARY KEY (session_key, fingerprint)
) WITHOUT ROWID;
CREATE INDEX speech_message_window ON speech_messages(session_key, timestamp);
CREATE TABLE speech_staged_messages (
  fingerprint TEXT PRIMARY KEY,
  source TEXT NOT NULL,
  timestamp REAL NOT NULL,
  counts TEXT NOT NULL
) WITHOUT ROWID;
CREATE TABLE speech_word_deltas (
  word TEXT PRIMARY KEY,
  user_count INTEGER NOT NULL,
  assistant_count INTEGER NOT NULL
) WITHOUT ROWID;
CREATE TABLE speech_sessions (
  session_key TEXT PRIMARY KEY,
  source_version TEXT NOT NULL,
  cutoff REAL NOT NULL
) WITHOUT ROWID;
`;

/** Membership set plus per-session totals; replaces per-message JSON receipts. */
/**
 * Drop the per-message tables from the discovery database. The learned counts
 * moved to their own local-disk file (below), and fingerprints are a filter.
 */
export const SPEECH_VOCABULARY_SET_SCHEMA = `
DROP TABLE IF EXISTS speech_messages;
DROP TABLE IF EXISTS speech_staged_messages;
DROP TABLE IF EXISTS speech_word_deltas;
DROP TABLE IF EXISTS speech_words;
DROP TABLE IF EXISTS speech_sessions;
DROP TABLE IF EXISTS speech_seen;
`;
