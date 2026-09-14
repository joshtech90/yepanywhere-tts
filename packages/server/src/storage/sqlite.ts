/**
 * The built-in SQLite adapter moved to @yep-anywhere/shared so relay and push
 * broker can share one implementation instead of carrying a native addon. This
 * path stays because server code and the packaged runtime contract scripts
 * (scripts/test-discovery-sqlite.mjs) load dist/storage/sqlite.js directly.
 */
export {
  loadSqliteDriver,
  openSqliteOrThrow,
  type SqliteDatabase,
  type SqliteDriver,
  type SqliteRow,
  type SqliteRunResult,
  type SqliteStatement,
  type SqliteValue,
} from "@yep-anywhere/shared/sqlite";
