import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  parseByteSize,
  reserveScratchSpace,
} from "../../src/lib/scratchSpace.js";

const directories: string[] = [];
const filesystem = vi.hoisted(() => ({ memoryRoot: "" }));

vi.mock("node:fs", async (original) => {
  const fs = await original<typeof import("node:fs")>();
  return {
    ...fs,
    statfsSync: (path: import("node:fs").PathLike) => ({
      ...fs.statfsSync(path),
      type:
        filesystem.memoryRoot && String(path).startsWith(filesystem.memoryRoot)
          ? 0x01021994
          : 0xef53,
      bsize: 4096,
      bavail: 1024 * 1024,
    }),
  };
});

beforeEach(() => {
  filesystem.memoryRoot = "";
});

afterEach(() => {
  for (const dir of directories.splice(0))
    rmSync(dir, { recursive: true, force: true });
});

function scratch(): string {
  const dir = mkdtempSync(join(tmpdir(), "ya-scratch-space-"));
  directories.push(dir);
  return dir;
}

it("reads sizes with and without a binary suffix", () => {
  expect(parseByteSize("256M", 0)).toBe(256 * 1024 * 1024);
  expect(parseByteSize("1g", 0)).toBe(1024 ** 3);
  expect(parseByteSize("4096", 0)).toBe(4096);
  expect(parseByteSize(undefined, 17)).toBe(17);
  expect(parseByteSize("", 17)).toBe(17);
  expect(() => parseByteSize("many", 0)).toThrow();
});

it("uses the configured directory and creates it", () => {
  const base = scratch();
  const dataDir = scratch();
  const space = reserveScratchSpace({
    purpose: "speech-vocabulary",
    bytes: 1024,
    dataDir,
    env: { YEP_SCRATCH_DIR: base },
  });
  expect(space.dir.startsWith(join(base, "speech-vocabulary-"))).toBe(true);
  expect(existsSync(space.dir)).toBe(true);
  expect(space.bytes).toBe(1024);
  expect(space.degraded).toBe(false);
});

it("keeps two data directories apart under one scratch root", () => {
  const base = scratch();
  const reserve = (dataDir: string) =>
    reserveScratchSpace({
      purpose: "speech-vocabulary",
      bytes: 1024,
      dataDir,
      env: { YEP_SCRATCH_DIR: base },
    }).dir;
  expect(reserve(scratch())).not.toBe(reserve(scratch()));
});

it("rejects a memory-backed override and selects the local cache", () => {
  const base = scratch();
  const cache = scratch();
  filesystem.memoryRoot = base;
  const space = reserveScratchSpace({
    purpose: "test-cache",
    bytes: 1024,
    dataDir: scratch(),
    env: { YEP_SCRATCH_DIR: base, XDG_CACHE_HOME: cache },
  });
  expect(space.dir.startsWith(join(cache, "yep-anywhere", "test-cache-"))).toBe(
    true,
  );
  expect(existsSync(space.dir)).toBe(true);
  expect(space.bytes).toBe(1024);
  expect(space.degraded).toBe(false);
});

it("grants less than asked rather than filling the disk", () => {
  const base = scratch();
  const space = reserveScratchSpace({
    purpose: "speech-vocabulary",
    // No filesystem has this, so every candidate falls short and the roomiest
    // one wins with a reduced grant.
    bytes: Number.MAX_SAFE_INTEGER,
    dataDir: scratch(),
    minimumBytes: 4096,
    env: { YEP_SCRATCH_DIR: base },
  });
  expect(space.bytes).toBeGreaterThanOrEqual(4096);
  expect(space.bytes).toBeLessThan(space.requested);
  expect(space.degraded).toBe(true);
  expect(space.reason).toContain(space.dir);
});
