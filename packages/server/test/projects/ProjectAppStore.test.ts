import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ProjectAppStore } from "../../src/projects/ProjectAppStore.js";

describe("retained project app state", () => {
  const directories: string[] = [];
  afterEach(async () => {
    for (const directory of directories.splice(0))
      await rm(directory, { recursive: true });
  });
  async function fixture() {
    const directory = await mkdtemp(join(tmpdir(), "ya-project-apps-"));
    directories.push(directory);
    return { directory, store: new ProjectAppStore(directory) };
  }

  it("retains ordered artifact identity and principal-specific hide/restore history", async () => {
    const { store, directory } = await fixture();
    const [first, latest] = await Promise.all([
      store.associate("project", "/project/one.html", "session-one"),
      store.associate("project", "/project/two.html", "session-two"),
    ]);
    expect(latest.order).toBeGreaterThan(first.order);
    await store.setHidden("project", "archer", true, "archer");
    await store.close();
    const restored = new ProjectAppStore(directory);
    expect(await restored.latestArtifact("project")).toEqual(latest);
    expect(await restored.hiddenProjectIds("archer")).toEqual(
      new Set(["project"]),
    );
    expect(await restored.hiddenProjectIds("other")).toEqual(new Set());
    await restored.setHidden("project", "archer", false, "superuser");
    expect(await restored.hiddenProjectIds("archer")).toEqual(new Set());
    expect(await restored.visibilityHistory("project")).toMatchObject([
      { username: "archer", actor: "archer", hidden: true },
      { username: "archer", actor: "superuser", hidden: false },
    ]);
    expect(await restored.latestArtifact("project")).toEqual(latest);
    expect(
      await readFile(join(directory, "project-apps.json"), "utf8"),
    ).not.toContain("http");
    await restored.close();
  });

  it("gives concurrent address claims one winner, retains it after restart and does not publish on claim", async () => {
    const { store, directory } = await fixture();
    const requests = ["first", "second"].map((projectId) =>
      store.reserve(
        {
          namespace: "apps.example",
          name: "canvas",
          projectId,
          owner: projectId,
        },
        async () => {},
      ),
    );
    const settled = await Promise.allSettled(requests);
    expect(
      settled.filter((entry) => entry.status === "fulfilled"),
    ).toHaveLength(1);
    expect(settled.filter((entry) => entry.status === "rejected")).toHaveLength(
      1,
    );
    const [reservation] = await store.reservations("first");
    expect(reservation).toMatchObject({
      serving: false,
      public: false,
      owner: "first",
    });
    // A rejected claim must not poison subsequent valid writes.
    await store.setHidden("first", "first", true, "first");
    await store.close();
    const restored = new ProjectAppStore(directory);
    expect(await restored.reservations("first")).toEqual([reservation]);
    await expect(
      restored.reserve(
        {
          namespace: "apps.example",
          name: "canvas",
          projectId: "second",
          owner: "second",
        },
        async () => {},
      ),
    ).rejects.toThrow("already reserved");
    await expect(
      restored.setServing("first", "apps.example", true, true, async () => {
        throw new Error("Publication denied");
      }),
    ).rejects.toThrow("Publication denied");
    const limited = async () => ({ allowed: false, superuser: false });
    await expect(
      restored.setServing("first", "apps.example", true, true, limited),
    ).rejects.toThrow("require a private link");
    expect(await restored.reservations("first")).toEqual([reservation]);
    await restored.setServing("first", "apps.example", true, false, limited);
    expect(await restored.reservations("first")).toMatchObject([
      { serving: true, public: false },
    ]);
    // Superuser public access survives a limited user's unchanged re-save and
    // is discarded when public access is turned off.
    await restored.setServing(
      "first",
      "apps.example",
      true,
      true,
      async () => ({
        allowed: true,
        superuser: true,
      }),
    );
    const keep = async () => ({ allowed: true, superuser: false });
    await restored.setServing("first", "apps.example", false, true, keep);
    expect(await restored.reservations("first")).toMatchObject([
      { serving: false, public: true, superuserPublic: true },
    ]);
    await restored.setServing("first", "apps.example", false, false, keep);
    await restored.setServing("first", "apps.example", false, true, keep);
    expect(await restored.reservations("first")).toMatchObject([
      { public: true, superuserPublic: false },
    ]);
    await restored.close();
  });
});
