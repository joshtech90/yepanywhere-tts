import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { source } from "./sodium.mjs";

test("cold and stale builds use the same vendored sodium without downloads", async () => {
  const build = await mkdtemp(join(tmpdir(), "ya-sodium-"));
  const originalFetch = globalThis.fetch;
  globalThis.fetch = () => {
    throw new Error("Pinned sodium preparation must remain offline");
  };
  try {
    const vendored = new URL(
      "../vendor/libsodium/libsodium-1.0.22-stable.tar.gz",
      import.meta.url,
    );
    const archive = await readFile(vendored);
    const signature = await readFile(new URL(`${vendored.href}.minisig`));
    const directory = join(build, "sodium-source");
    for (const stale of [false, true]) {
      if (stale) {
        await mkdir(directory, { recursive: true });
        await writeFile(join(directory, "LATEST.tar.gz"), "stale archive");
        await writeFile(
          join(directory, "LATEST.tar.gz.minisig"),
          "stale signature",
        );
      }
      await source(build);
      assert.deepEqual(
        await readFile(join(directory, "LATEST.tar.gz")),
        archive,
      );
      assert.deepEqual(
        await readFile(join(directory, "LATEST.tar.gz.minisig")),
        signature,
      );
    }
  } finally {
    globalThis.fetch = originalFetch;
    await rm(build, { recursive: true, force: true });
  }
});
