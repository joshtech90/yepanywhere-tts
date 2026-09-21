import * as fs from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { writeFileAtomically } from "../../src/utils/writeFileAtomically.js";

describe("writeFileAtomically", () => {
  let directory: string;

  beforeEach(async () => {
    directory = await fs.mkdtemp(join(tmpdir(), "ya-atomic-write-"));
  });

  afterEach(async () => {
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
});
