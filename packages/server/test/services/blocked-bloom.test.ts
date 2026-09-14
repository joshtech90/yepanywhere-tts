import { createHash } from "node:crypto";
import { mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import {
  BlockedBloom,
  bloomCapacity,
  BloomFile,
} from "../../src/services/voice/blocked-bloom.js";

const directories: string[] = [];
afterEach(() => {
  for (const dir of directories.splice(0))
    rmSync(dir, { recursive: true, force: true });
});

function scratch(): string {
  const dir = mkdtempSync(join(tmpdir(), "ya-bloom-"));
  directories.push(dir);
  return dir;
}

const digest = (value: string): Uint8Array =>
  createHash("sha256").update(value).digest();

it("answers every added key and rarely claims one it never saw", () => {
  const filter = new BlockedBloom(1024 * 1024);
  const added = 20_000;
  for (let index = 0; index < added; index++) filter.add(digest(`in-${index}`));
  expect(filter.count).toBe(added);
  for (let index = 0; index < added; index++)
    expect(filter.has(digest(`in-${index}`))).toBe(true);
  let claimed = 0;
  for (let index = 0; index < added; index++)
    if (filter.has(digest(`out-${index}`))) claimed++;
  // Well under the design load, so the rate is far below the one percent that
  // full occupancy targets. A miss costs one skipped message, never a bad count.
  expect(claimed / added).toBeLessThan(0.001);
});

it("reports saturation at its design load", () => {
  const bytes = 64 * 1024;
  const filter = new BlockedBloom(bytes);
  expect(filter.capacity).toBe(bloomCapacity(bytes));
  expect(filter.saturated).toBe(false);
  const half = Math.floor(filter.capacity / 2);
  for (let index = 0; index < half; index++) filter.add(digest(`key-${index}`));
  expect(filter.saturated).toBe(false);
  // Past capacity, not exactly at it: a key the filter already claims to hold
  // is not counted, so a run of distinct keys inserts slightly fewer.
  for (let index = half; index < filter.capacity * 1.2; index++)
    filter.add(digest(`key-${index}`));
  expect(filter.saturated).toBe(true);
});

it("keeps its keys across a reopen and writes only what changed", async () => {
  const dir = scratch();
  const path = join(dir, "seen.bloom");
  const filter = new BlockedBloom(1024 * 1024);
  const file = new BloomFile(path, filter);
  expect(await file.load()).toBe(false);
  for (let index = 0; index < 500; index++) filter.add(digest(`key-${index}`));
  expect(filter.pendingWrites).toBeGreaterThan(0);
  await file.persist();
  expect(filter.pendingWrites).toBe(0);
  await file.close();

  const reopened = new BlockedBloom(1024 * 1024);
  const reopenedFile = new BloomFile(path, reopened);
  expect(await reopenedFile.load()).toBe(true);
  expect(reopened.count).toBe(500);
  for (let index = 0; index < 500; index++)
    expect(reopened.has(digest(`key-${index}`))).toBe(true);
  await reopenedFile.close();
});

it("reserves its full size once and never truncates it afterwards", async () => {
  const dir = scratch();
  const path = join(dir, "seen.bloom");
  const filter = new BlockedBloom(1024 * 1024);
  const file = new BloomFile(path, filter);
  await file.load();
  const reserved = statSync(path).size;
  expect(reserved).toBeGreaterThanOrEqual(1024 * 1024);
  filter.add(digest("first"));
  await file.persist();
  expect(statSync(path).size).toBe(reserved);
  await file.close();
});

it("starts empty when the file was written for a different shape", async () => {
  const dir = scratch();
  const path = join(dir, "seen.bloom");
  const filter = new BlockedBloom(1024 * 1024);
  const file = new BloomFile(path, filter);
  await file.load();
  filter.add(digest("key"));
  await file.persist();
  await file.close();

  const resized = new BlockedBloom(2 * 1024 * 1024);
  const resizedFile = new BloomFile(path, resized);
  expect(await resizedFile.load()).toBe(false);
  expect(resized.count).toBe(0);
  expect(resized.has(digest("key"))).toBe(false);
  await resizedFile.close();
});
