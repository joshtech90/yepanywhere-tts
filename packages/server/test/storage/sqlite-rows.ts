import type {
  SqliteDatabase,
  SqliteRow,
  SqliteValue,
} from "../../src/storage/sqlite.js";

/**
 * Read rows straight from a test database, preparing and finalizing one
 * statement. `IssueStore` keeps its own SQL private and answers callers through
 * named methods, so a test that wants to see stored rows — including the PRAGMA
 * and schema queries no store method covers — states its own SQL here rather
 * than reopening a general-purpose query method on the store.
 */
export function storedRows(
  database: SqliteDatabase,
  sql: string,
  ...values: SqliteValue[]
): SqliteRow[] {
  const statement = database.prepare(sql);
  try {
    return statement.all(...values);
  } finally {
    statement.finalize();
  }
}
