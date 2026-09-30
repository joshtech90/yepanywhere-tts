import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { toUrlProjectId } from "@yep-anywhere/shared";
import { Hono } from "hono";
import { afterEach, beforeEach, expect, it } from "vitest";
import { LimitedUsersService } from "../../src/auth/LimitedUsersService.js";
import {
  PRINCIPAL_VARIABLE,
  type Principal,
} from "../../src/auth/principal.js";
import { createProjectAccessRoutes } from "../../src/routes/project-access.js";

const projectPath = "/home/me/archer/game";
const projectId = toUrlProjectId(projectPath);
let directory: string;
let users: LimitedUsersService;
let principal: Principal;
let app: Hono;

function limited(username: string): Principal {
  const grants = users.getActiveGrants(username);
  if (!grants) throw new Error(`no grants for ${username}`);
  return {
    kind: "limited",
    username,
    grants,
    switched: false,
    locked: true,
    via: "direct",
  };
}

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "ya-project-access-"));
  users = new LimitedUsersService({ dataDir: directory });
  await users.initialize();
  for (const username of ["archer", "bobby", "carol"])
    await users.create({ username, password: "password123" });
  principal = limited("archer");
  app = new Hono();
  app.use("*", async (c, next) => {
    c.set(PRINCIPAL_VARIABLE as never, principal as never);
    await next();
  });
  app.route(
    "/api",
    createProjectAccessRoutes({
      scanner: {
        getProject: async (id: string) =>
          id === projectId ? ({ id, path: projectPath } as never) : null,
      },
      limitedUsers: users,
      metadata: {
        getProjectOwner: (path: string) =>
          path === projectPath ? "archer" : undefined,
      },
    }),
  );
});
afterEach(async () => {
  await users.flushPendingWrites();
  await rm(directory, { recursive: true });
});

function put(body: unknown) {
  return app.request(`/api/projects/${projectId}/access`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

it("lets the creator share their project at any level with other limited users", async () => {
  await users.update("bobby", {
    pathGrants: [{ path: "/home/me/archer", level: "view" }],
  });
  expect((await put({ username: "bobby", level: "new-session" })).status).toBe(
    200,
  );
  expect(users.getActiveGrants("bobby")?.newSessionProjects).toEqual([
    projectId,
  ]);

  const listed = await (
    await app.request(`/api/projects/${projectId}/access`)
  ).json();
  // The creator is not offered their own access.
  expect(listed.users).toEqual([
    { username: "bobby", level: "new-session", directoryLevel: "view" },
    { username: "carol", level: "none", directoryLevel: "none" },
  ]);

  expect((await put({ username: "bobby", level: "none" })).status).toBe(200);
  expect(users.getActiveGrants("bobby")?.newSessionProjects).toEqual([]);
});

it("refuses a limited user who did not create the project, and odd requests", async () => {
  expect((await put({ username: "archer", level: "view" })).status).toBe(400);
  expect((await put({ username: "nobody", level: "view" })).status).toBe(404);
  expect((await put({ username: "bobby", level: "admin" })).status).toBe(400);
  principal = limited("bobby");
  expect((await put({ username: "carol", level: "view" })).status).toBe(403);
  expect((await app.request(`/api/projects/${projectId}/access`)).status).toBe(
    403,
  );
  expect(users.getActiveGrants("carol")?.viewProjects).toEqual([]);
});

it("lets the superuser share any project", async () => {
  principal = { kind: "superuser" };
  expect((await put({ username: "carol", level: "join" })).status).toBe(200);
  // Check the explicit project grant, apart from the user's private workspace.
  expect(users.get("carol")?.joinProjects).toEqual([projectId]);
});
