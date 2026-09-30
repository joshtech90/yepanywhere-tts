import { mkdtemp, rm } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { projectAccessLevel, toUrlProjectId } from "@yep-anywhere/shared";
import { afterEach, beforeEach, expect, it } from "vitest";
import { LimitedUsersService } from "../../src/auth/LimitedUsersService.js";

let directory: string;
let users: LimitedUsersService;
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "ya-path-grants-"));
  users = new LimitedUsersService({ dataDir: directory });
  await users.initialize();
  await users.create({ username: "alice", password: "password123" });
});
afterEach(async () => {
  await users.flushPendingWrites();
  await rm(directory, { recursive: true });
});

it("stores directory grants resolved, persists them, and grants beneath them", async () => {
  await users.update("alice", {
    pathGrants: [
      { path: "~/kids/", level: "join" },
      { path: "/srv/shared/../apps", level: "view" },
    ],
  });
  const reloaded = new LimitedUsersService({ dataDir: directory });
  await reloaded.initialize();
  const grants = reloaded.getActiveGrants("alice");
  expect(grants?.pathGrants).toEqual([
    { path: join(homedir(), "kids"), level: "join" },
    { path: "/srv/apps", level: "view" },
  ]);
  expect(
    projectAccessLevel(grants!, toUrlProjectId(join(homedir(), "kids/game"))),
  ).toBe("join");
  expect(projectAccessLevel(grants!, toUrlProjectId("/srv/shared/x"))).toBe(
    "none",
  );
  await reloaded.flushPendingWrites();
});

it("refuses a relative directory without changing the saved grants", async () => {
  await expect(
    users.update("alice", { pathGrants: [{ path: "kids", level: "view" }] }),
  ).rejects.toThrow("absolute");
  expect(users.getActiveGrants("alice")?.pathGrants).toEqual([]);
});
