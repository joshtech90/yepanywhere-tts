import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { DiscoverySqliteService } from "../../src/storage/discovery-sqlite.js";

describe("optional discovery storage failure isolation", () => {
  it("retains an initialization error even when partial-open cleanup fails", () => {
    const dataDir = mkdtempSync(join(tmpdir(), "ya-sqlite-failure-"));
    const initializationError = new Error("database unavailable");
    const close = vi.fn(() => {
      throw new Error("close also failed");
    });
    const onError = vi.fn();
    try {
      const service = new DiscoverySqliteService({
        dataDir,
        mode: "auto",
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
        onError,
      });
      expect(service.getStatus()).toEqual({ state: "error" });
      expect(service.getDatabase()).toBeUndefined();
      expect(close).toHaveBeenCalledOnce();
      expect(onError).toHaveBeenCalledWith(initializationError);
      service.close();
      expect(close).toHaveBeenCalledOnce();
    } finally {
      rmSync(dataDir, { recursive: true, force: true });
    }
  });
});

describe("data directory placement", () => {
  const dataDir = () => {
    const dir = mkdtempSync(join(tmpdir(), "ya-sqlite-placement-"));
    return {
      dir,
      [Symbol.dispose]: () => rmSync(dir, { recursive: true, force: true }),
    };
  };

  it("refuses a network data directory and names the filesystem", () => {
    using data = dataDir();
    const open = vi.fn();
    const onError = vi.fn();
    const service = new DiscoverySqliteService({
      dataDir: data.dir,
      mode: "auto",
      loadDriver: () => ({ open }),
      probeNetworkFilesystem: () => "NFS",
      onError,
    });
    expect(service.getStatus()).toEqual({
      state: "error",
      networkFilesystem: "NFS",
    });
    expect(service.getDatabase()).toBeUndefined();
    expect(open).not.toHaveBeenCalled();
    expect(String(onError.mock.calls[0]?.[0])).toContain("YEP_DATA_DIR");
  });

  it("opens a local data directory and reports no filesystem advice", () => {
    using data = dataDir();
    const service = new DiscoverySqliteService({
      dataDir: data.dir,
      mode: "auto",
      probeNetworkFilesystem: () => undefined,
    });
    expect(service.getStatus()).toEqual({ state: "ready" });
    service.close();
  });

  // Callers that gate a feature on readiness and callers that ask for the
  // handle must select the same servers: the speech vocabulary feature reads
  // readiness (app.ts) while the issue indexer takes the handle.
  it("hands out its database exactly when it reports ready", () => {
    using data = dataDir();
    const disabled = new DiscoverySqliteService({
      dataDir: data.dir,
      mode: "off",
    });
    expect(disabled.getStatus().state).toBe("disabled");
    expect(disabled.getDatabase()).toBeUndefined();

    const service = new DiscoverySqliteService({
      dataDir: data.dir,
      mode: "auto",
      probeNetworkFilesystem: () => undefined,
    });
    expect(service.getStatus().state).toBe("ready");
    expect(service.getDatabase()).toBeDefined();

    service.close();
    expect(service.getStatus().state).toBe("disabled");
    expect(service.getDatabase()).toBeUndefined();
  });

  it("opens a network data directory when the operator asks for it", () => {
    using data = dataDir();
    const probe = vi.fn(() => "NFS");
    const service = new DiscoverySqliteService({
      dataDir: data.dir,
      mode: "on",
      probeNetworkFilesystem: probe,
    });
    expect(service.getStatus()).toEqual({ state: "ready" });
    expect(probe).not.toHaveBeenCalled();
    service.close();
  });
});
