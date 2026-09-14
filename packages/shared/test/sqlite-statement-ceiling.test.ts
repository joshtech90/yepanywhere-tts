import { afterEach, describe, expect, it, vi } from "vitest";
import { openSqliteOrThrow } from "../src/sqlite.js";

/**
 * The ceiling exists to make one Bun-only defect visible on Node: a caller that
 * prepares the same SQL per call retains every statement until close under Bun,
 * while Node's collector hides it. These tests assert the check itself, since a
 * guard nobody exercises is indistinguishable from a guard that never fires.
 */
describe("SQLite statement ceiling", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  function open() {
    const db = openSqliteOrThrow(":memory:");
    db.exec("CREATE TABLE t (id TEXT PRIMARY KEY, n INTEGER)");
    return db;
  }

  it("fails a caller that prepares the same SQL per call", () => {
    vi.stubEnv("YEP_SQLITE_STATEMENT_CEILING", "4");
    const db = open();
    try {
      expect(() => {
        for (let i = 0; i < 20; i++) db.prepare("SELECT n FROM t WHERE id = ?");
      }).toThrow(/YEP_SQLITE_STATEMENT_CEILING=4/);
    } finally {
      db.close();
    }
  });

  it("names the repeated statement so the caller is findable", () => {
    vi.stubEnv("YEP_SQLITE_STATEMENT_CEILING", "2");
    const db = open();
    try {
      expect(() => {
        for (let i = 0; i < 10; i++) db.prepare("SELECT n FROM t WHERE id = ?");
      }).toThrow(/SELECT n FROM t WHERE id = \?/);
    } finally {
      db.close();
    }
  });

  it("allows reuse of one prepared statement without limit", () => {
    vi.stubEnv("YEP_SQLITE_STATEMENT_CEILING", "2");
    const db = open();
    try {
      const insert = db.prepare("INSERT INTO t VALUES (?, ?)");
      for (let i = 0; i < 500; i++) insert.run(`id${i}`, i);
      expect(
        db.prepare("SELECT COUNT(*) AS c FROM t").get<{ c: number }>()?.c,
      ).toBe(500);
    } finally {
      db.close();
    }
  });

  it("releases a slot when the caller finalizes", () => {
    vi.stubEnv("YEP_SQLITE_STATEMENT_CEILING", "2");
    const db = open();
    try {
      for (let i = 0; i < 50; i++) {
        const statement = db.prepare("SELECT n FROM t WHERE id = ?");
        statement.get("absent");
        statement.finalize();
      }
    } finally {
      db.close();
    }
  });

  it("tracks nothing when the ceiling is unset", () => {
    vi.stubEnv("YEP_SQLITE_STATEMENT_CEILING", "");
    const db = open();
    try {
      for (let i = 0; i < 200; i++) db.prepare("SELECT n FROM t WHERE id = ?");
    } finally {
      db.close();
    }
  });

  it("rejects a ceiling that is not a positive integer", () => {
    vi.stubEnv("YEP_SQLITE_STATEMENT_CEILING", "zero");
    expect(() => openSqliteOrThrow(":memory:")).toThrow(
      /must be a positive integer/,
    );
  });
});
