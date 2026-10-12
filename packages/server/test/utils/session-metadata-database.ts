import { SessionMetadataService } from "../../src/metadata/SessionMetadataService.js";
import { openDiscoveryDatabase } from "../../src/storage/discovery-sqlite.js";
import type { SqliteDatabase } from "../../src/storage/sqlite.js";

const openDatabases = new Set<SqliteDatabase>();

/**
 * Open the required discovery database below a test data directory. Each call
 * is a new connection, as a restarted server would have; close them all with
 * {@link closeTestDiscoveryDatabases} before removing the directory, since an
 * open SQLite file cannot be deleted on Windows.
 */
export function openTestDiscoveryDatabase(dataDir: string): SqliteDatabase {
  const database = openDiscoveryDatabase({
    dataDir,
    probeNetworkFilesystem: () => undefined,
  });
  openDatabases.add(database);
  return database;
}

/** A session metadata service on a fresh connection to `dataDir`'s database. */
export function createTestSessionMetadataService(
  dataDir: string,
): SessionMetadataService {
  return new SessionMetadataService({
    dataDir,
    database: openTestDiscoveryDatabase(dataDir),
  });
}

export function closeTestDiscoveryDatabases(): void {
  for (const database of openDatabases) database.close();
  openDatabases.clear();
}
