import { chmodSync, closeSync, mkdirSync, openSync } from "node:fs";
import { join } from "node:path";
import {
  openSqliteOrThrow,
  type SqliteDatabase,
} from "@yep-anywhere/shared/sqlite";

const SCHEMA_VERSION = 1;

export function createDatabase(dataDir: string): SqliteDatabase {
  mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  const databasePath = join(dataDir, "push-broker.db");
  const databaseFile = openSync(databasePath, "a", 0o600);
  closeSync(databaseFile);
  chmodSync(databasePath, 0o600);
  const db = openSqliteOrThrow(databasePath);
  initializeDatabase(db, true);
  return db;
}

export function createTestDatabase(databasePath = ":memory:"): SqliteDatabase {
  const db = openSqliteOrThrow(databasePath);
  initializeDatabase(db, databasePath !== ":memory:");
  return db;
}

function initializeDatabase(db: SqliteDatabase, persistent: boolean): void {
  db.exec("PRAGMA foreign_keys = ON");
  db.exec("PRAGMA busy_timeout = 5000");
  if (persistent) {
    db.exec("PRAGMA journal_mode = WAL");
    db.exec("PRAGMA synchronous = NORMAL");
  }

  const version =
    db.prepare("PRAGMA user_version").get<{ user_version: number }>()
      ?.user_version ?? 0;
  if (version > SCHEMA_VERSION) {
    db.close();
    throw new Error(
      `Push broker database schema ${version} is newer than supported ${SCHEMA_VERSION}`,
    );
  }

  if (version === 0) {
    db.transaction(() => {
      db.exec(`
        CREATE TABLE installations (
          id TEXT PRIMARY KEY,
          auth_hash BLOB NOT NULL,
          provider TEXT NOT NULL,
          target_kind TEXT NOT NULL,
          target_value TEXT NOT NULL,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        );

        CREATE TABLE subscriptions (
          id TEXT PRIMARY KEY,
          installation_id TEXT NOT NULL
            REFERENCES installations(id) ON DELETE CASCADE,
          send_hash BLOB NOT NULL,
          created_at INTEGER NOT NULL,
          last_used_at INTEGER,
          revoked_at INTEGER
        );

        CREATE INDEX idx_subscriptions_installation
          ON subscriptions(installation_id);

        PRAGMA user_version = 1;
      `);
    });
  }
}
