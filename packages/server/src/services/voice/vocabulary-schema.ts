/**
 * The learned vocabulary table, in its own database beside the fingerprint
 * filter on local disk rather than in the data directory's discovery file.
 * Both are rebuilt by rescanning provider history, so they belong wherever
 * writing them is cheapest.
 *
 * Counts stay per-word rows: ranking needs the word strings back, and only the
 * words a scan touched are rewritten.
 */
export const SPEECH_VOCABULARY_TABLE_SCHEMA = `
CREATE TABLE IF NOT EXISTS speech_words (
  word TEXT PRIMARY KEY,
  user_count INTEGER NOT NULL,
  assistant_count INTEGER NOT NULL
) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS speech_word_forms (
  word TEXT NOT NULL,
  surface TEXT NOT NULL,
  free_count REAL NOT NULL,
  forced_count REAL NOT NULL,
  PRIMARY KEY (word, surface)
) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS speech_sessions (
  session_key TEXT PRIMARY KEY,
  source_version TEXT NOT NULL,
  cutoff REAL NOT NULL
) WITHOUT ROWID;
`;
