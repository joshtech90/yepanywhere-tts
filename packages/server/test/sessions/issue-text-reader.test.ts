import { mkdtemp, writeFile, appendFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { readIssueTextBatch } from "../../src/sessions/issue-text-reader.js";

const directories: string[] = [];
afterEach(async () => {
  for (const directory of directories.splice(0))
    await rm(directory, { recursive: true });
});
const line = (id: string) =>
  JSON.stringify({
    type: "user",
    uuid: id,
    timestamp: "2026-09-14T12:00:00Z",
    message: { role: "user", content: `needle ${id}` },
  });
async function fixture(text: string) {
  const directory = await mkdtemp(join(tmpdir(), "search-text-"));
  directories.push(directory);
  const path = join(directory, "session.jsonl");
  await writeFile(path, text);
  return {
    path,
    read: (cursor?: string) =>
      readIssueTextBatch("claude", [{ path }], {
        cursor,
        signal: new AbortController().signal,
        maxRecords: 4,
      }),
  };
}

it("leaves an unfinished live record at the tail without reporting a read failure", async () => {
  const second = line("second");
  const { path, read } = await fixture(
    `${line("first")}\n${second.slice(0, 30)}`,
  );
  const initial = await read();
  expect(initial.done).toBe(true);
  expect(initial.partial).toBe(true);
  expect(initial.recordErrors).toBe(false);
  expect(initial.diagnostics).toEqual([]);
  await appendFile(path, `${second.slice(30)}\n`);
  const next = await read(initial.cursor);
  expect(next.restarted).toBeUndefined();
  expect(next.messages.map((m) => m.id)).toEqual(["second"]);
  expect(next.partial).toBe(false);
});

it("identifies skipped records by byte offset and a preceding readable turn", async () => {
  const prefix = `${line("first")}\n`;
  const { read } = await fixture(
    `${prefix}not-json\n${"x".repeat(1024 * 1024 + 1)}\n${line("last")}\n`,
  );
  const batch = await read();
  expect(batch.partial).toBe(true);
  expect(batch.diagnostics).toHaveLength(2);
  expect(batch.diagnostics?.[0]).toMatchObject({
    byteOffset: Buffer.byteLength(prefix),
    messageId: "first",
  });
  expect(batch.diagnostics?.[1]?.message).toContain(
    "1048576-byte search limit",
  );
  const next = await read(batch.cursor);
  expect(next.diagnostics).toEqual([]);
});

it("returns a valid replacement cursor and new turns after a native rewrite", async () => {
  const { path, read } = await fixture(`${line("old")}\n`);
  const initial = await read();
  await writeFile(path, `${line("replacement-with-a-longer-id")}\n`);
  const next = await read(initial.cursor);
  expect(next.restarted).toBe(true);
  expect(next.messages.map((m) => m.id)).toEqual([
    "replacement-with-a-longer-id",
  ]);
  expect(next.partial).toBe(false);
});
