import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { GrantStore } from "../../src/artifacts/GrantStore.js";

const directories: string[] = [];
afterEach(async () => {
  for (const path of directories.splice(0)) await rm(path, { recursive: true });
});

function grant(id: string) {
  return {
    id,
    token: `token-${id}`,
    root: `/tmp/${id}`,
    entry: "index.html",
    expiresAt: Date.now() + 60_000,
    owned: false,
  };
}

it("survives two stores writing the same state directory at once", async () => {
  const directory = await mkdtemp(join(tmpdir(), "ya-grant-store-"));
  directories.push(directory);
  // One process can hold several artifact servers over one state directory —
  // every server built from the same data directory does. A staging name they
  // share lets one rename steal the other's file, which used to reject with
  // ENOENT from a write nobody was awaiting.
  const first = new GrantStore(directory);
  const second = new GrantStore(directory);
  await Promise.all([
    first.save([grant("first")], []),
    second.save([grant("second")], []),
    first.save([grant("first-again")], []),
  ]);
  await Promise.all([first.settled(), second.settled()]);

  const saved: unknown = JSON.parse(
    await readFile(join(directory, "grants.json"), "utf8"),
  );
  expect(
    (saved as { grants: { id: string }[] }).grants.map((row) => row.id),
  ).toHaveLength(1);
  // A finished write leaves the state file and nothing else behind.
  expect(await readdir(directory)).toEqual(["grants.json"]);
});

it("reports a write that cannot be staged instead of losing it", async () => {
  const directory = await mkdtemp(join(tmpdir(), "ya-grant-store-"));
  directories.push(directory);
  await writeFile(join(directory, "blocker"), "not a directory");
  const store = new GrantStore(join(directory, "blocker", "state"));
  await expect(store.save([grant("unwritable")], [])).rejects.toThrow();
  // A failed write must not poison another store: a later one still lands.
  const recovered = new GrantStore(directory);
  await recovered.save([grant("recovered")], []);
  expect(await readFile(join(directory, "grants.json"), "utf8")).toContain(
    "recovered",
  );
});
