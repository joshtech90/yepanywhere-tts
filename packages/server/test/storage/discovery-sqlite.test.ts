import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  DiscoverySqliteService,
  DiscoveryStorageError,
} from "../../src/storage/discovery-sqlite.js";

const dataDir = () => {
  const dir = mkdtempSync(join(tmpdir(), "ya-sqlite-required-"));
  return {
    dir,
    [Symbol.dispose]: () => rmSync(dir, { recursive: true, force: true }),
  };
};

describe("required discovery storage", () => {
  it("throws the initialization error even when partial-open cleanup fails", () => {
    using data = dataDir();
    const initializationError = new Error("database unavailable");
    const close = vi.fn(() => {
      throw new Error("close also failed");
    });
    const open = () =>
      new DiscoverySqliteService({
        dataDir: data.dir,
        probeNetworkFilesystem: () => undefined,
        loadDriver: () => ({
          open: () => ({
            exec: () => {
              throw initializationError;
            },
            prepare: () => {
              throw new Error("not reached");
            },
            transaction: () => {
              throw new Error("not reached");
            },
            close,
          }),
        }),
      });
    expect(open).toThrow(DiscoveryStorageError);
    expect(open).toThrow(/database unavailable/);
    expect(close).toHaveBeenCalledTimes(2);
  });

  it("names the runtime when no SQLite driver is available", () => {
    using data = dataDir();
    expect(
      () =>
        new DiscoverySqliteService({
          dataDir: data.dir,
          loadDriver: () => undefined,
        }),
    ).toThrow(/no built-in SQLite/);
  });

  it("refuses a network data directory and points at YEP_DATA_DIR", () => {
    using data = dataDir();
    const open = vi.fn();
    expect(
      () =>
        new DiscoverySqliteService({
          dataDir: data.dir,
          loadDriver: () => ({ open }),
          probeNetworkFilesystem: () => "NFS",
        }),
    ).toThrow(/on NFS.*YEP_DATA_DIR/);
    expect(open).not.toHaveBeenCalled();
  });

  it("opens a local data directory and closes once", () => {
    using data = dataDir();
    const service = new DiscoverySqliteService({
      dataDir: data.dir,
      probeNetworkFilesystem: () => undefined,
    });
    expect(service.getStatus()).toEqual({ state: "ready" });
    expect(service.getDatabase()).toBeDefined();

    service.close();
    service.close();
    expect(service.getStatus()).toEqual({ state: "disabled" });
    expect(() => service.getDatabase()).toThrow(/closed/);
  });
});
