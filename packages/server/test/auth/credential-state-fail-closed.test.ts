import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { LimitedUsersService } from "../../src/auth/LimitedUsersService.js";
import { ProjectMetadataService } from "../../src/metadata/ProjectMetadataService.js";
import { RemoteAccessService } from "../../src/remote-access/RemoteAccessService.js";

// Credential state never starts "fresh" from a file it cannot read: that
// once turned a truncated auth.json into a server with no password, and for
// these stores it would silently delete every limited user or the relay
// credential (topics/security.md).
describe("credential state that cannot be read", () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = await fs.mkdtemp(path.join(os.tmpdir(), "credential-state-"));
  });

  afterEach(async () => {
    await fs.rm(testDir, { recursive: true, force: true });
  });

  const stores = [
    {
      file: "limited-users.json",
      create: (dataDir: string) => new LimitedUsersService({ dataDir }),
    },
    {
      file: "remote-access.json",
      create: (dataDir: string) => new RemoteAccessService({ dataDir }),
    },
    {
      // Not a credential, but its project ownership backs limited users'
      // grants.
      file: "project-metadata.json",
      create: (dataDir: string) => new ProjectMetadataService({ dataDir }),
    },
  ];

  for (const store of stores) {
    for (const [label, content] of [
      ["empty", ""],
      ["truncated", '{"version":2,"users":{"arch'],
    ] as const) {
      it(`${store.file}: refuses to start from ${label} state and keeps it`, async () => {
        const filePath = path.join(testDir, store.file);
        await fs.writeFile(filePath, content, { mode: 0o600 });
        await expect(store.create(testDir).initialize()).rejects.toThrow(
          /Refusing to start/,
        );
        expect(await fs.readFile(filePath, "utf8")).toBe(content);
      });
    }

    it(`${store.file}: a missing file still starts unconfigured`, async () => {
      await expect(store.create(testDir).initialize()).resolves.toBeUndefined();
    });
  }
});
