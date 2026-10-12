// Runs the same contract against Node and the pinned desktop Bun. Accept the
// npm staging storage directory to also verify the actual published modules.
// Node 22/24 may emit its built-in SQLite ExperimentalWarning here. This is
// intentional runtime provenance for the approved built-in driver, not a test
// failure or a warning to intercept; Bun does not emit that Node notice.
import assert from "node:assert/strict";
import { mkdtempSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const [expected, storageDir = "packages/server/dist/storage", sharedFile] =
  process.argv.slice(2);
// SQLite is required: every supported runtime must provide it.
assert.equal(expected, "ready", "Pass ready");
const { DiscoverySqliteService, migrateDiscoveryDatabase } = await import(
  pathToFileURL(resolve(storageDir, "discovery-sqlite.js")).href
);
const { loadSqliteDriver } = await import(
  pathToFileURL(resolve(storageDir, "sqlite.js")).href
);
const temporary = mkdtempSync(join(tmpdir(), "ya-sqlite-contract-"));
const connections = [];
function openService(dataDir, extra = {}) {
  const service = new DiscoverySqliteService({ dataDir, ...extra });
  connections.push(service);
  return service;
}
try {
  const unsupportedDir = join(temporary, "unsupported");
  assert.throws(
    () => openService(unsupportedDir, { loadDriver: () => undefined }),
    /no built-in SQLite/,
  );
  assert.equal(existsSync(unsupportedDir), false);

  const dataDir = join(temporary, "enabled");
  const service = openService(dataDir);
  assert.deepEqual(service.getStatus(), { state: expected });
  // Status snapshots cannot mutate retained readiness.
  service.getStatus().state = "error";
  assert.equal(service.getStatus().state, expected);
  {
    const db = service.getDatabase();
    assert.ok(db);
    assert.equal(db.prepare("PRAGMA foreign_keys").get().foreign_keys, 1);
    assert.equal(db.prepare("PRAGMA busy_timeout").get().timeout, 250);
    db.exec(
      "CREATE TABLE entries (id INTEGER PRIMARY KEY, title TEXT, payload BLOB)",
    );
    const insert = db.prepare("INSERT INTO entries VALUES (?, ?, ?)");
    const finalized = db.prepare("SELECT 1");
    finalized.finalize();
    finalized.finalize();
    assert.throws(() => finalized.get(), /closed/);
    const title = "PR #1691: 'quoted'; DROP TABLE entries; --";
    insert.run(1, title, new Uint8Array([0, 255]));
    insert.run(2, null, null);
    assert.equal(
      db.prepare("SELECT title FROM entries WHERE id = ?").get(1).title,
      title,
    );
    assert.deepEqual(
      Array.from(
        db.prepare("SELECT payload FROM entries WHERE id = ?").get(1).payload,
      ),
      [0, 255],
    );
    assert.equal(
      db.prepare("SELECT title FROM entries WHERE id = ?").get(2).title,
      null,
    );
    assert.equal(
      db.prepare("SELECT * FROM entries WHERE id = ?").get(3),
      undefined,
    );
    assert.equal(db.prepare("SELECT * FROM entries").all().length, 2);
    assert.throws(
      () =>
        db.transaction(() => {
          insert.run(3, "rolled back", null);
          throw new Error("abort");
        }),
      /abort/,
    );
    assert.equal(
      db.prepare("SELECT * FROM entries WHERE id = 3").get(),
      undefined,
    );
    assert.equal(
      db.transaction(() => {
        insert.run(4, "committed", null);
        return 42;
      }),
      42,
    );
    assert.throws(
      () => db.transaction(() => db.transaction(() => {})),
      /Nested/,
    );
    assert.throws(() => db.transaction(() => Promise.resolve()), /synchronous/);
    db.exec(
      "CREATE TABLE unique_entries (value INTEGER UNIQUE ON CONFLICT ROLLBACK)",
    );
    assert.throws(
      () =>
        db.transaction(() => {
          db.exec("INSERT INTO unique_entries VALUES (1), (1)");
        }),
      /UNIQUE constraint failed/,
    );
    assert.equal(
      db.prepare("SELECT count(*) AS n FROM unique_entries").get().n,
      0,
    );

    const other = openService(dataDir);
    assert.equal(other.getStatus().state, "ready");
    db.transaction(() => {
      assert.throws(
        () =>
          other
            .getDatabase()
            .exec("INSERT INTO entries VALUES (5, 'locked', NULL)"),
        /locked|busy/i,
      );
    });
    other.close();
    service.close();
    service.close();
    assert.throws(() => insert.run(6, "after close", null), /closed/);
    assert.throws(() => service.getDatabase(), /closed/);
    assert.equal(service.getStatus().state, "disabled");
    const reopened = openService(dataDir);
    assert.equal(
      reopened.getDatabase().prepare("SELECT count(*) AS n FROM entries").get()
        .n,
      3,
    );

    const db2 = reopened.getDatabase();
    const schemaVersion = db2.prepare("PRAGMA user_version").get().user_version;
    const migrations = [
      ...Array.from({ length: schemaVersion }, (_, index) => ({
        version: index + 1,
        sql: "",
      })),
      {
        version: schemaVersion + 1,
        sql: "CREATE TABLE next_feature (id INTEGER)",
      },
    ];
    assert.throws(() =>
      migrateDiscoveryDatabase(db2, [
        ...migrations,
        { version: schemaVersion + 2, sql: "INVALID SQL" },
      ]),
    );
    assert.equal(
      db2.prepare("PRAGMA user_version").get().user_version,
      schemaVersion,
    );
    assert.equal(
      db2
        .prepare("SELECT name FROM sqlite_schema WHERE name = 'next_feature'")
        .get(),
      undefined,
    );
    migrateDiscoveryDatabase(db2, migrations);
    migrateDiscoveryDatabase(db2, migrations);
    assert.equal(
      db2.prepare("PRAGMA user_version").get().user_version,
      schemaVersion + 1,
    );
    reopened.close();
    const databaseFile = join(dataDir, "discovery.sqlite");
    const newerBytes = readFileSync(databaseFile);
    assert.throws(() => openService(dataDir), /newer/);
    assert.deepEqual(readFileSync(databaseFile), newerBytes);

    const corruptDir = join(temporary, "corrupt");
    // First create the directory through a successful service, then corrupt only
    // this test-owned file after closing its connection.
    openService(corruptDir).close();
    const corruptFile = join(corruptDir, "discovery.sqlite");
    const corruptBytes = Buffer.from("This is not a SQLite database");
    writeFileSync(corruptFile, corruptBytes);
    assert.throws(() => openService(corruptDir), /Cannot open/);
    assert.deepEqual(readFileSync(corruptFile), corruptBytes);

    const invalidDirectory = join(temporary, "file-instead-of-directory");
    writeFileSync(invalidDirectory, "keep");
    assert.throws(() => openService(invalidDirectory));
    assert.equal(readFileSync(invalidDirectory, "utf8"), "keep");

    const closeFailure = openService(join(temporary, "close-failure"), {
      loadDriver: () => ({
        open(path) {
          const native = loadSqliteDriver().open(path);
          return {
            ...native,
            close() {
              native.close();
              throw new Error("simulated close failure");
            },
          };
        },
      }),
    });
    assert.equal(closeFailure.getStatus().state, "ready");
    const warn = console.warn;
    let closeError;
    console.warn = (_prefix, error) => {
      closeError = error;
    };
    try {
      closeFailure.close();
    } finally {
      console.warn = warn;
    }
    assert.equal(closeFailure.getStatus().state, "disabled");
    assert.throws(() => closeFailure.getDatabase(), /closed/);
    assert.match(closeError.message, /close failure/);

    // CI supplies the same path to Node then Bun: the second runtime must read
    // the first runtime's actual file before appending its own row.
    if (sharedFile) {
      const existed = existsSync(sharedFile);
      const shared = loadSqliteDriver().open(sharedFile);
      connections.push(shared);
      migrateDiscoveryDatabase(shared);
      shared.exec("CREATE TABLE IF NOT EXISTS runtimes (name TEXT)");
      if (existed)
        assert.ok(shared.prepare("SELECT name FROM runtimes").all().length > 0);
      shared
        .prepare("INSERT INTO runtimes VALUES (?)")
        .run(process.versions.bun ? "bun" : "node");
    }
  }
  console.log(
    `Discovery SQLite contract passed (${process.versions.bun ? `Bun ${process.versions.bun}` : `Node ${process.versions.node}`}, ${expected})`,
  );
} finally {
  for (const connection of connections.reverse()) connection.close();
  await rm(temporary, {
    recursive: true,
    force: true,
    maxRetries: 3,
    retryDelay: 100,
  });
}
