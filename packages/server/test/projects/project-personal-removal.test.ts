import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { toUrlProjectId, type LimitedUserGrants } from "@yep-anywhere/shared";
import { Hono } from "hono";
import { expect, it } from "vitest";
import { SessionAccessResolver } from "../../src/auth/sessionAccess.js";
import { ProjectMetadataService } from "../../src/metadata/ProjectMetadataService.js";
import { createLimitedUsersMiddleware } from "../../src/middleware/limited-users.js";
import { ProjectAppStore } from "../../src/projects/ProjectAppStore.js";
import { ProjectScanner } from "../../src/projects/scanner.js";
import { createProjectsRoutes } from "../../src/routes/projects.js";

it("limited deletion hides lists after reconnect while the superuser retains the canonical project and history", async () => {
  const root = await mkdtemp(join(tmpdir(), "ya-personal-removal-"));
  const dataDir = join(root, "data");
  const projectPath = join(root, "project");
  await mkdir(projectPath);
  await writeFile(join(projectPath, "history.txt"), "Retain me");
  const projectId = toUrlProjectId(projectPath);
  const metadata = new ProjectMetadataService({ dataDir });
  await metadata.initialize();
  await metadata.addProject(projectId, projectPath, "archer");
  const scanner = new ProjectScanner({
    projectsDir: join(root, "claude"),
    enableCodex: false,
    enableGemini: false,
    projectMetadataService: metadata,
  });
  let store = new ProjectAppStore(dataDir);
  const grants: LimitedUserGrants = {
    newSessionProjects: [projectId],
    joinProjects: [],
    viewProjects: [],
    joinStaleOffsetMinutes: 0,
    lock: {},
  };
  const build = (username: string | null) => {
    const app = new Hono();
    app.use(
      "/api/*",
      createLimitedUsersMiddleware({
        getActiveGrants: (name) => (name === "archer" ? grants : null),
        getHiddenProjectIds: (name) => store.hiddenProjectIds(name),
        getSuperuserIdentity: () => "owner",
        getCookieSessionUsername: async () => username,
        getCookieSecret: () => "test-secret",
        sessionAccess: new SessionAccessResolver({
          getLiveSession: () => undefined,
          readCatalogRows: async () => [
            { sessionId: "retained-session", projectId },
          ],
          getSessionMetadata: () => ({
            workingProjectId: projectId,
            createdByUser: "archer",
          }),
        }),
      }),
    );
    app.get("/api/projects", async (c) =>
      c.json({ projects: await scanner.listProjects() }),
    );
    app.get("/api/sessions", (c) =>
      c.json({
        sessions: [{ id: "retained-session", projectId }],
        projects: [{ id: projectId }],
      }),
    );
    app.get("/api/sessions/retained-session", (c) =>
      c.json({ retained: true }),
    );
    app.route(
      "/api/projects",
      createProjectsRoutes({
        scanner,
        readerFactory: () => {
          throw new Error("Unused by removal");
        },
        projectMetadataService: metadata,
        projectAppStore: store,
      }),
    );
    return app;
  };
  try {
    const limited = build("archer");
    expect(
      (await (await limited.request("/api/projects")).json()).projects,
    ).toHaveLength(1);
    const removed = await limited.request(`/api/projects/${projectId}`, {
      method: "DELETE",
    });
    expect(removed.status).toBe(200);
    expect(await removed.json()).toMatchObject({
      personal: true,
      removed: true,
    });
    await store.close();
    store = new ProjectAppStore(dataDir);
    const reconnected = build("archer");
    expect(
      (await (await reconnected.request("/api/projects")).json()).projects,
    ).toEqual([]);
    expect(await (await reconnected.request("/api/sessions")).json()).toEqual({
      sessions: [],
      projects: [],
    });
    expect(
      (await reconnected.request("/api/sessions/retained-session")).status,
    ).toBe(200);
    const superuser = build(null);
    expect(
      (await (await superuser.request("/api/projects")).json()).projects,
    ).toHaveLength(1);
    expect(
      (await (await superuser.request("/api/sessions")).json()).sessions,
    ).toHaveLength(1);
    expect(await readFile(join(projectPath, "history.txt"), "utf8")).toBe(
      "Retain me",
    );
    expect(await store.visibilityHistory(projectId)).toMatchObject([
      { username: "archer", actor: "archer", hidden: true },
    ]);
    expect(await scanner.getProject(projectId)).toMatchObject({
      ownerUsername: "archer",
    });
  } finally {
    await store.close();
    await scanner.dispose();
    await rm(root, { recursive: true });
  }
});
