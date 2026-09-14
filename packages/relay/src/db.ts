import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import {
  openSqliteOrThrow,
  type SqliteDatabase,
} from "@yep-anywhere/shared/sqlite";

const USERNAMES_SCHEMA = `
  CREATE TABLE IF NOT EXISTS usernames (
    username TEXT PRIMARY KEY,
    install_id TEXT NOT NULL,
    registered_at TEXT NOT NULL,
    last_seen_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_usernames_last_seen
    ON usernames(last_seen_at);
`;

/**
 * Creates and initializes the SQLite database for username registry.
 *
 * Schema:
 * - usernames: Maps usernames to installation IDs with timestamps
 */
export function createDb(dataDir: string): SqliteDatabase {
  // Ensure data directory exists
  if (!existsSync(dataDir)) {
    mkdirSync(dataDir, { recursive: true });
  }

  const db = openSqliteOrThrow(join(dataDir, "relay.db"));

  // WAL mode gives better concurrent read performance
  db.exec("PRAGMA journal_mode = WAL");
  db.exec(USERNAMES_SCHEMA);

  return db;
}

/**
 * Creates an in-memory database for testing.
 */
export function createTestDb(): SqliteDatabase {
  const db = openSqliteOrThrow(":memory:");
  db.exec(USERNAMES_SCHEMA);
  return db;
}
