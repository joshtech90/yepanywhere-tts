import * as fs from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { writeFileAtomically } from "../../src/utils/writeFileAtomically.js";
import * as directorySync from "../../src/utils/syncDirectory.js";

vi.mock("node:fs/promises", async (importOriginal) => ({
  ...(await importOriginal<typeof import("node:fs/promises")>()),
}));

describe("writeFileAtomically", () => {
  let directory: string;

  beforeEach(async () => {
    directory = await fs.mkdtemp(join(tmpdir(), "ya-atomic-write-"));
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    await fs.rm(directory, { recursive: true, force: true });
  });

  it("publishes the contents and leaves nothing staged", async () => {
    const file = join(directory, "state.json");
    await writeFileAtomically(file, '{"version":1}\n');
    expect(await fs.readFile(file, "utf8")).toBe('{"version":1}\n');
    expect(await fs.readdir(directory)).toEqual(["state.json"]);
  });

  it("replaces an existing file", async () => {
    const file = join(directory, "state.json");
    await fs.writeFile(file, "old");
    await writeFileAtomically(file, "new");
    expect(await fs.readFile(file, "utf8")).toBe("new");
    expect(await fs.readdir(directory)).toEqual(["state.json"]);
  });

  it.runIf(process.platform !== "win32")(
    "restricts the file to its owner unless told otherwise",
    async () => {
      const secret = join(directory, "secret");
      await writeFileAtomically(secret, "token");
      expect((await fs.stat(secret)).mode & 0o777).toBe(0o600);

      const shared = join(directory, "shared");
      await writeFileAtomically(shared, "public", { mode: 0o644 });
      expect((await fs.stat(shared)).mode & 0o777).toBe(0o644);
    },
  );

  it("removes the staging file when publishing fails", async () => {
    const occupied = join(directory, "occupied");
    await fs.mkdir(occupied);
    await expect(writeFileAtomically(occupied, "contents")).rejects.toThrow();
    expect(await fs.readdir(directory)).toEqual(["occupied"]);
  });

  it("lets concurrent writers publish over one path", async () => {
    const file = join(directory, "contended.json");
    await Promise.all([
      writeFileAtomically(file, "first"),
      writeFileAtomically(file, "second"),
    ]);
    expect(["first", "second"]).toContain(await fs.readFile(file, "utf8"));
    expect(await fs.readdir(directory)).toEqual(["contended.json"]);
  });

  it("syncs and closes staged data before publication, then syncs the directory", async () => {
    const file = join(directory, "durable.json");
    await fs.writeFile(file, "old");
    const events: string[] = [];
    const open = fs.open;
    vi.spyOn(fs, "open").mockImplementationOnce(async (...args) => {
      const handle = await open(...args);
      const sync = handle.sync.bind(handle);
      const close = handle.close.bind(handle);
      vi.spyOn(handle, "sync").mockImplementation(async () => {
        await sync();
        events.push("file sync");
      });
      vi.spyOn(handle, "close").mockImplementation(async () => {
        await close();
        events.push("close");
      });
      return handle;
    });
    const rename = fs.rename;
    vi.spyOn(fs, "rename").mockImplementationOnce(async (from, to) => {
      expect(await fs.readFile(file, "utf8")).toBe("old");
      expect(await fs.readFile(from, "utf8")).toBe("new");
      events.push("rename");
      await rename(from, to);
    });
    const syncDirectory = directorySync.syncDirectory;
    vi.spyOn(directorySync, "syncDirectory").mockImplementationOnce(
      async (path) => {
        expect(path).toBe(directory);
        expect(await fs.readFile(file, "utf8")).toBe("new");
        events.push("directory sync");
        await syncDirectory(path);
      },
    );

    await writeFileAtomically(file, "new", { durable: true });
    expect(events).toEqual(["file sync", "close", "rename", "directory sync"]);
    expect(await fs.readdir(directory)).toEqual(["durable.json"]);
  });

  it.each(["write", "sync", "close"] as const)(
    "preserves the previous file and removes staging when durable %s fails",
    async (stage) => {
      const file = join(directory, "durable.json");
      await fs.writeFile(file, "old");
      const failure = Object.assign(new Error("file operation failed"), {
        code: "EPERM",
      });
      const open = fs.open;
      vi.spyOn(fs, "open").mockImplementationOnce(async (...args) => {
        const handle = await open(...args);
        if (stage === "write")
          vi.spyOn(handle, "writeFile").mockRejectedValueOnce(failure);
        if (stage === "sync")
          vi.spyOn(handle, "sync").mockRejectedValueOnce(failure);
        if (stage === "close") {
          const close = handle.close.bind(handle);
          vi.spyOn(handle, "close").mockImplementationOnce(async () => {
            await close();
            throw failure;
          });
        }
        return handle;
      });

      await expect(
        writeFileAtomically(file, "new", { durable: true }),
      ).rejects.toBe(failure);
      expect(await fs.readFile(file, "utf8")).toBe("old");
      expect(await fs.readdir(directory)).toEqual(["durable.json"]);
    },
  );

  it("reports directory-sync failures after publishing without discarding the new file", async () => {
    const file = join(directory, "durable.json");
    await fs.writeFile(file, "old");
    const failure = Object.assign(new Error("directory sync failed"), {
      code: "EIO",
    });
    vi.spyOn(directorySync, "syncDirectory").mockRejectedValueOnce(failure);

    await expect(
      writeFileAtomically(file, "new", { durable: true }),
    ).rejects.toBe(failure);
    expect(await fs.readFile(file, "utf8")).toBe("new");
    expect(await fs.readdir(directory)).toEqual(["durable.json"]);
  });

  describe.each(["win32", "linux", "darwin"])("%s publication", (platform) => {
    it.each(["EPERM", "EACCES", "EBUSY"])(
      "recovers from transient %s only on Windows",
      async (code) => {
        vi.stubGlobal("process", { ...process, platform });
        const file = join(directory, "state.json");
        await fs.writeFile(file, "old");
        const failure = Object.assign(new Error("replacement locked"), {
          code,
        });
        vi.spyOn(fs, "rename").mockRejectedValueOnce(failure);

        const result = writeFileAtomically(file, "new");
        if (platform === "win32") {
          await expect(result).resolves.toBeUndefined();
          expect(await fs.readFile(file, "utf8")).toBe("new");
        } else {
          await expect(result).rejects.toBe(failure);
          expect(await fs.readFile(file, "utf8")).toBe("old");
        }
        expect(await fs.readdir(directory)).toEqual(["state.json"]);
      },
    );

    it("rejects permanent replacement failures and preserves the old file", async () => {
      vi.stubGlobal("process", { ...process, platform });
      const file = join(directory, "state.json");
      await fs.writeFile(file, "old");
      const failure = Object.assign(new Error("replacement denied"), {
        code: "EPERM",
      });
      vi.spyOn(fs, "rename").mockRejectedValue(failure);

      await expect(writeFileAtomically(file, "new")).rejects.toBe(failure);
      expect(await fs.readFile(file, "utf8")).toBe("old");
      expect(await fs.readdir(directory)).toEqual(["state.json"]);
    });
  });
});
