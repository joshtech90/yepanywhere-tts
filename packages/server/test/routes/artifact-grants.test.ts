import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ArtifactServer } from "../../src/artifacts/ArtifactServer.js";
import { createLocalResourcePathPolicy } from "../../src/routes/local-resource-policy.js";

const directories: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const directory of directories.splice(0))
    await rm(directory, { recursive: true, force: true });
});

async function workspace() {
  const base = await mkdtemp(join(tmpdir(), "ya-artifact-state-"));
  directories.push(base);
  const bundle = join(base, "bundle");
  await mkdir(bundle, { recursive: true });
  await writeFile(join(bundle, "index.html"), "<h1>Artifact</h1>");
  return { base, bundle, entry: join(bundle, "index.html") };
}

function serverFor(base: string, config: Record<string, unknown> = {}) {
  return new ArtifactServer(
    {
      port: 4402,
      localOrigin: "http://artifacts.localhost:3400",
      ...config,
    },
    createLocalResourcePathPolicy({ allowedPaths: [base] }),
    { stateDir: join(base, "state"), protectedPaths: [join(base, "state")] },
  );
}

const exists = (path: string) =>
  stat(path).then(
    () => true,
    () => false,
  );

describe("durable artifact grants", () => {
  it("serves a grant created by a previous process", async () => {
    const { base, entry } = await workspace();
    const first = serverFor(base);
    const grant = await first.createGrant(entry, "local");
    await first.settleExpired();
    await first.close();

    const second = serverFor(base);
    expect((await second.app.request(grant.url)).status).toBe(200);
    // The state file holds the bearer token, so its directory is the guard.
    expect(
      (await stat(join(base, "state")).then((s) => s.mode & 0o777)) & 0o077,
    ).toBe(0);
    expect(
      await readFile(join(base, "state", "grants.json"), "utf8"),
    ).toContain(grant.id);
    await second.close();
  });

  it("drops a grant that expired while the server was down", async () => {
    const { base, bundle, entry } = await workspace();
    const now = Date.now();
    const clock = vi.spyOn(Date, "now").mockReturnValue(now);
    const first = serverFor(base, { expiryDays: 1 });
    const grant = await first.createGrant(entry, "local");
    await first.settleExpired();
    await first.close();

    clock.mockReturnValue(now + 25 * 3600_000);
    const second = serverFor(base, { expiryDays: 1 });
    await second.ready;
    expect((await second.app.request(grant.url)).status).toBe(404);
    // Borrowing is the default, so nothing was deleted with it.
    expect(await exists(join(bundle, "index.html"))).toBe(true);
    await second.close();
  });

  it("deletes an owning grant's directory when it expires", async () => {
    const { base, bundle, entry } = await workspace();
    const now = Date.now();
    const clock = vi.spyOn(Date, "now").mockReturnValue(now);
    const server = serverFor(base, {
      expiryDays: 1,
      deleteOnExpiry: true,
    });
    const grant = await server.createGrant(entry, "local", true);
    expect(grant.owned).toBe(true);
    expect(await exists(bundle)).toBe(true);

    clock.mockReturnValue(now + 25 * 3600_000);
    await server.settleExpired();
    expect(await exists(bundle)).toBe(false);
    await server.close();
  });

  it("pays a deletion the previous process did not reach", async () => {
    const { base, bundle, entry } = await workspace();
    const now = Date.now();
    const clock = vi.spyOn(Date, "now").mockReturnValue(now);
    const first = serverFor(base, {
      expiryDays: 1,
      deleteOnExpiry: true,
    });
    await first.createGrant(entry, "local", true);
    await first.settleExpired();
    await first.close();
    expect(await exists(bundle)).toBe(true);

    clock.mockReturnValue(now + 25 * 3600_000);
    const second = serverFor(base, {
      expiryDays: 1,
      deleteOnExpiry: true,
    });
    await second.ready;
    expect(await exists(bundle)).toBe(false);
    await second.close();
  });

  it("deletes on revocation and leaves a borrowed directory alone", async () => {
    const { base, bundle, entry } = await workspace();
    const owning = serverFor(base, { deleteOnExpiry: true });
    const owned = await owning.createGrant(entry, "local", true);
    owning.revoke(owned.id);
    await owning.settleExpired();
    expect(await exists(bundle)).toBe(false);
    await owning.close();

    await mkdir(bundle, { recursive: true });
    await writeFile(entry, "<h1>Artifact</h1>");
    const borrowing = serverFor(base, { deleteOnExpiry: false });
    const borrowed = await borrowing.createGrant(entry, "local");
    expect(borrowed.owned).toBe(false);
    borrowing.revoke(borrowed.id);
    await borrowing.settleExpired();
    expect(await exists(entry)).toBe(true);
    await borrowing.close();
  });

  it("refuses to own a working tree or a protected directory", async () => {
    const { base, bundle, entry } = await workspace();
    await mkdir(join(bundle, ".git"), { recursive: true });
    const server = serverFor(base, { deleteOnExpiry: true });
    const grant = await server.createGrant(entry, "local", true);
    expect(grant.owned).toBe(false);
    await server.settleExpired();
    expect(await exists(entry)).toBe(true);
    await server.close();

    // A directory holding YA's own state is never a disposable bundle.
    const stateHolder = new ArtifactServer(
      { port: 4402, localOrigin: "http://artifacts.localhost:3400" },
      createLocalResourcePathPolicy({ allowedPaths: [base] }),
      { stateDir: join(base, "state"), protectedPaths: [base] },
    );
    const held = await stateHolder.createGrant(entry, "local", true);
    expect(held.owned).toBe(false);
    await stateHolder.close();
  });

  it("removes only the fileset it froze, and keeps a directory someone reused", async () => {
    const { base, bundle, entry } = await workspace();
    await mkdir(join(bundle, "assets"), { recursive: true });
    await writeFile(join(bundle, "assets", "app.js"), "// served");
    const now = Date.now();
    const clock = vi.spyOn(Date, "now").mockReturnValue(now);
    const server = serverFor(base, { expiryDays: 1, deleteOnExpiry: true });
    const grant = await server.createGrant(entry, "local", true);
    expect(grant.owned).toBe(true);

    // Written after the grant existed, so the grant has no claim on it.
    await writeFile(join(bundle, "notes.md"), "mine");
    clock.mockReturnValue(now + 25 * 3600_000);
    await server.settleExpired();
    expect(await exists(entry)).toBe(false);
    expect(await exists(join(bundle, "assets", "app.js"))).toBe(false);
    expect(await exists(join(bundle, "assets"))).toBe(false);
    // The directory still holds someone else's file, so it stays.
    expect(await readFile(join(bundle, "notes.md"), "utf8")).toBe("mine");
    await server.close();
  });

  it("removes the directory when its frozen fileset was all of it", async () => {
    const { base, bundle, entry } = await workspace();
    const now = Date.now();
    const clock = vi.spyOn(Date, "now").mockReturnValue(now);
    const server = serverFor(base, { expiryDays: 1, deleteOnExpiry: true });
    await server.createGrant(entry, "local", true);
    clock.mockReturnValue(now + 25 * 3600_000);
    await server.settleExpired();
    expect(await exists(bundle)).toBe(false);
    await server.close();
  });

  it("never inherits ownership from configuration", async () => {
    const { base, entry } = await workspace();
    const server = serverFor(base, { deleteOnExpiry: true });
    const owned = await server.createGrant(entry, "local", true);
    await server.configure({ ...server.config, deleteOnExpiry: false });
    expect(owned.owned).toBe(true);
    const borrowed = await server.createGrant(entry, "local");
    expect(borrowed.owned).toBe(false);
    // An explicit request still overrides the configured default either way.
    expect((await server.createGrant(entry, "local", true)).owned).toBe(true);
    await server.close();
  });
});
