import { mkdtemp, open, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, expect, it } from "vitest";
import { openedFileStream } from "../../src/artifacts/openedFileStream.js";

let root: string;
let path: string;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "ya-opened-file-"));
  path = join(root, "bytes.bin");
  await writeFile(
    path,
    new Uint8Array(256 * 1024).map((_, i) => i % 251),
  );
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

it("bounds pulls and preserves an exact authorized positional range", async () => {
  const handle = await open(path, "r");
  const reader = openedFileStream(handle, 17, 150000).getReader();
  let offset = 17;
  for (;;) {
    const part = await reader.read();
    if (part.done) break;
    expect(part.value.length).toBeLessThanOrEqual(65536);
    expect(part.value).toEqual(
      Uint8Array.from(
        { length: part.value.length },
        (_, i) => (offset + i) % 251,
      ),
    );
    offset += part.value.length;
  }
  expect(offset).toBe(150001);
  expect(handle.fd).toBe(-1);
});

it("settles cancellation with a filesystem read in flight and closes every fd", async () => {
  // Repeated native media seek cancellation, including an unread response and
  // an admitted read. Late I/O must never enqueue into a cancelled controller.
  for (let i = 0; i < 64; i++) {
    const handle = await open(path, "r");
    const reader = openedFileStream(handle, 0, 256 * 1024 - 1).getReader();
    if (i % 2) await reader.read();
    const pending = reader.read();
    await Promise.resolve(); // Admit pull before cancellation; filesystem I/O is pending.
    await reader.cancel();
    expect(await pending).toEqual({ done: true, value: undefined });
    expect(handle.fd).toBe(-1);
    expect(await reader.read()).toEqual({ done: true, value: undefined });
  }
});

it("closes a small unread response while retaining its buffered bytes", async () => {
  const handle = await open(path, "r");
  const response = new Response(openedFileStream(handle, 0, 4));
  await expect.poll(() => handle.fd).toBe(-1);
  expect(new Uint8Array(await response.arrayBuffer())).toEqual(
    new Uint8Array([0, 1, 2, 3, 4]),
  );
});

it("rejects a truncated snapshot and releases the descriptor", async () => {
  const handle = await open(path, "r");
  await writeFile(path, "short");
  const response = new Response(openedFileStream(handle, 0, 65535));
  await expect(response.arrayBuffer()).rejects.toThrow(
    "File ended before response length",
  );
  expect(handle.fd).toBe(-1);
});
