/**
 * Session metadata moves out of `session-metadata.json`. Each row holds one
 * session's metadata object as JSON; the single import row records that the
 * legacy file was read once and must never be read again
 * (docs/tactical/150-ya-owned-session-ids.md).
 */
export const SESSION_METADATA_SCHEMA = `
CREATE TABLE session_metadata (
  session_id TEXT PRIMARY KEY NOT NULL,
  metadata TEXT NOT NULL
) WITHOUT ROWID;
CREATE TABLE session_metadata_import (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  imported_at TEXT NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('json', 'none'))
);
`;
