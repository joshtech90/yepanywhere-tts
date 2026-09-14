import { isValidRelayUsername } from "@yep-anywhere/shared";
import type {
  SqliteDatabase,
  SqliteStatement,
} from "@yep-anywhere/shared/sqlite";

export interface UsernameRecord {
  username: string;
  install_id: string;
  registered_at: string;
  last_seen_at: string;
}

/**
 * Username registry backed by SQLite.
 *
 * Manages username ownership:
 * - First-come-first-served registration
 * - Same installId can reclaim their username
 * - Different installId is rejected
 * - Inactive usernames can be reclaimed after N days
 */
export class UsernameRegistry {
  private db: SqliteDatabase;
  /**
   * One prepared statement per distinct SQL, reused for the registry's life.
   * Preparing per call repeats SQLite's parse and plan work on every request,
   * and under Bun each statement also stays alive until the database closes.
   */
  private readonly prepared = new Map<string, SqliteStatement>();

  constructor(db: SqliteDatabase) {
    this.db = db;
  }

  private statement(sql: string): SqliteStatement {
    let statement = this.prepared.get(sql);
    if (!statement) {
      statement = this.db.prepare(sql);
      this.prepared.set(sql, statement);
    }
    return statement;
  }

  /**
   * Check if a username can be registered by the given installId.
   * Returns true if:
   * - Username is not registered, or
   * - Username is registered to this installId
   */
  canRegister(username: string, installId: string): boolean {
    if (!isValidRelayUsername(username)) {
      return false;
    }

    const row = this.statement(
      "SELECT install_id FROM usernames WHERE username = ?",
    ).get<{ install_id: string }>(username);

    if (!row) {
      return true; // Not registered
    }

    return row.install_id === installId; // Same owner
  }

  /**
   * Register or update a username claim.
   * Updates last_seen_at on every call.
   *
   * @returns true if registration succeeded, false if username is taken by another installId
   */
  register(username: string, installId: string): boolean {
    if (!isValidRelayUsername(username)) {
      return false;
    }

    const now = new Date().toISOString();

    // Check existing registration
    const existing = this.statement(
      "SELECT install_id FROM usernames WHERE username = ?",
    ).get<{ install_id: string }>(username);

    if (existing) {
      if (existing.install_id !== installId) {
        return false; // Different owner
      }

      // Update last_seen_at for existing owner
      this.statement(
        "UPDATE usernames SET last_seen_at = ? WHERE username = ?",
      ).run(now, username);
      return true;
    }

    // New registration
    this.statement(
      "INSERT INTO usernames (username, install_id, registered_at, last_seen_at) VALUES (?, ?, ?, ?)",
    ).run(username, installId, now, now);
    return true;
  }

  /**
   * Update last_seen_at timestamp for a username.
   * Called on activity to prevent reclamation.
   */
  updateLastSeen(username: string): void {
    const now = new Date().toISOString();
    this.statement(
      "UPDATE usernames SET last_seen_at = ? WHERE username = ?",
    ).run(now, username);
  }

  /**
   * Get a username record.
   */
  get(username: string): UsernameRecord | undefined {
    return this.statement(
      "SELECT * FROM usernames WHERE username = ?",
    ).get<UsernameRecord>(username);
  }

  /**
   * Check if a username is registered (by any installId).
   */
  isRegistered(username: string): boolean {
    const row = this.statement(
      "SELECT 1 FROM usernames WHERE username = ?",
    ).get(username);
    return row !== undefined;
  }

  /**
   * Delete usernames that haven't been seen in N days.
   * Returns the number of deleted records.
   */
  reclaimInactive(days: number): number {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - days);
    const cutoffIso = cutoff.toISOString();

    const result = this.statement(
      "DELETE FROM usernames WHERE last_seen_at < ?",
    ).run(cutoffIso);

    return result.changes;
  }

  /**
   * Delete a username registration.
   * Used for testing or administrative cleanup.
   */
  delete(username: string): boolean {
    const result = this.statement(
      "DELETE FROM usernames WHERE username = ?",
    ).run(username);
    return result.changes > 0;
  }

  /**
   * Get all registered usernames (for debugging/admin).
   */
  list(): UsernameRecord[] {
    return this.statement(
      "SELECT * FROM usernames ORDER BY username",
    ).all<UsernameRecord>();
  }

  /**
   * Get the count of registered usernames.
   */
  count(): number {
    const row = this.statement("SELECT COUNT(*) as count FROM usernames").get<{
      count: number;
    }>();
    // COUNT(*) always yields a row; treat its absence as an empty registry.
    return row?.count ?? 0;
  }
}
