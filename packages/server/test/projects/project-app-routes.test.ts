import {
  mkdtemp,
  mkdir,
  realpath,
  rm,
  symlink,
  utimes,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  toUrlProjectId,
  type LimitedUserGrants,
  type ProjectServiceDeclaration,
} from "@yep-anywhere/shared";
import { Hono } from "hono";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ArtifactServer } from "../../src/artifacts/ArtifactServer.js";
import { ProjectAppDelivery } from "../../src/artifacts/ProjectAppDelivery.js";
import { projectAppPublicAllowed } from "../../src/projects/projectAppPolicy.js";
import {
  PRINCIPAL_VARIABLE,
  type Principal,
} from "../../src/auth/principal.js";
import { SessionAccessResolver } from "../../src/auth/sessionAccess.js";
import { ProjectAppStore } from "../../src/projects/ProjectAppStore.js";
import { ProjectServiceManager } from "../../src/projects/ProjectServiceManager.js";
import { ProjectScanner } from "../../src/projects/scanner.js";
import { ProjectMetadataService } from "../../src/metadata/ProjectMetadataService.js";
import { createArtifactRoutes } from "../../src/routes/artifacts.js";
import { createProjectAppRoutes } from "../../src/routes/project-app.js";
import { createLocalResourcePathPolicy } from "../../src/routes/local-resource-policy.js";
import { createSessionPathScopeResolver } from "../../src/routes/session-path-scope.js";

let root: string;
let projectPath: string;
let projectId: string;
let store: ProjectAppStore;
let services: ProjectServiceManager;
let artifacts: ArtifactServer;
let scanner: ProjectScanner;
let app: Hono;
let grants: LimitedUserGrants;
let principal: Principal;
let delivery: ProjectAppDelivery;
beforeEach(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), "ya-project-app-route-")));
  projectPath = join(root, "project");
  projectId = toUrlProjectId(projectPath);
  await mkdir(join(projectPath, ".project-template"), { recursive: true });
  await mkdir(join(projectPath, "dist"));
  await writeFile(
    join(projectPath, "dist/index.html"),
    "<h1>Static starter</h1>",
  );
  await writeFile(
    join(projectPath, ".project-template/app.json"),
    JSON.stringify({
      service: {
        version: 1,
        where: { kind: "static", root: "dist", entry: "index.html" },
        serving: { target: "static-root" },
      },
    }),
  );
  const dataDir = join(root, "data");
  const metadata = new ProjectMetadataService({ dataDir });
  await metadata.initialize();
  await metadata.addProject(projectId, projectPath, "archer");
  scanner = new ProjectScanner({
    projectsDir: join(root, "claude"),
    enableCodex: false,
    enableGemini: false,
    projectMetadataService: metadata,
  });
  store = new ProjectAppStore(dataDir);
  services = new ProjectServiceManager(dataDir);
  artifacts = new ArtifactServer(
    { port: 4402, localOrigin: "http://artifacts.localhost:4402" },
    createLocalResourcePathPolicy({ allowedPaths: [root] }),
  );
  grants = {
    viewProjects: [projectId],
    newSessionProjects: [],
    joinProjects: [],
    joinStaleOffsetMinutes: 0,
    lock: {},
  };
  principal = {
    kind: "limited",
    username: "archer",
    grants,
    switched: false,
    locked: true,
    via: "direct",
  };
  app = new Hono();
  app.use("*", async (c, next) => {
    c.set(PRINCIPAL_VARIABLE, principal);
    await next();
  });
  delivery = new ProjectAppDelivery(
    artifacts,
    services,
    store,
    async () => ({
      entry: join(projectPath, "dist/index.html"),
      root: join(projectPath, "dist"),
    }),
    async (reservation) =>
      projectAppPublicAllowed("archer", reservation, () => grants),
  );
  app.route(
    "/api",
    createProjectAppRoutes({
      scanner,
      store,
      services,
      artifacts,
      delivery,
      activeGrants: () => grants,
      sessionAccess: new SessionAccessResolver({
        getLiveSession: () => undefined,
        readCatalogRows: async () => [],
        getSessionMetadata: () => undefined,
      }),
      sessionPathScope: createSessionPathScopeResolver({
        sandboxStateRoot: join(dataDir, "session-sandboxes"),
        allowedPaths: () => [root],
        includeProjects: () => true,
      }),
      openService: async () => {
        throw new Error("A static app must not open a process service");
      },
    }),
  );
});
afterEach(async () => {
  await services.close();
  await store.close();
  await artifacts.close();
  await scanner.dispose();
  await rm(root, { recursive: true });
});
function post(action: string, body: unknown = {}) {
  return app.request(`/api/projects/${projectId}/app/${action}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

it("restricts inventory to administrators and retains orphan names for token-revoking release", async () => {
  const orphanId = toUrlProjectId(join(root, "gone"));
  await store.reserve(
    {
      projectId: orphanId,
      namespace: "old.example",
      name: "retained",
      owner: "archer",
    },
    async () => {},
  );
  expect((await app.request("/api/project-apps")).status).toBe(403);
  const release = () =>
    app.request("/api/project-apps/address/release", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectId: orphanId, namespace: "old.example" }),
    });
  expect((await release()).status).toBe(403);
  principal = { kind: "superuser" };
  const inventory = await (await app.request("/api/project-apps")).json();
  expect(inventory.projects).toHaveLength(1);
  expect(inventory.projects[0]).toMatchObject({
    projectId,
    owner: "archer",
    info: { state: "ready" },
  });
  expect(inventory.reservations).toMatchObject([
    { projectId: orphanId, name: "retained" },
  ]);
  expect(await services.status(projectId)).toBeNull();
  const rotate = vi.spyOn(artifacts.vhostAccess, "rotate");
  expect((await release()).status).toBe(200);
  expect(rotate).toHaveBeenCalledWith({
    name: "retained",
    projectId: orphanId,
  });
  expect(await store.allReservations()).toEqual([]);
  expect(
    (await (await app.request(`/api/projects/${projectId}/app`)).json()).state,
  ).toBe("ready");
});

it("enforces public publishing and private-link retrieval independently, including revocation", async () => {
  artifacts.config.vhostPublicRoot = "apps.example";
  artifacts.config.publicOrigin = "https://artifacts.example";
  grants.newSessionProjects = [projectId];
  expect((await post("address/reserve", { name: "archer-game" })).status).toBe(
    200,
  );
  const get = async () =>
    (await app.request(`/api/projects/${projectId}/app/address`)).json();
  let address = await get();
  expect(address.reservations[0].url).toMatch(
    /^https:\/\/archer-game\.apps\.example\/\?ya_access=/,
  );
  const privateUrl = address.reservations[0].url;
  expect(
    (await post("address/serve", { serving: true, public: true })).status,
  ).toBe(403);
  grants.allowPrivateAppLinks = false;
  expect((await get()).reservations[0].url).toBeUndefined();
  grants.allowPublicApps = true;
  expect(
    (await post("address/serve", { serving: true, public: true })).status,
  ).toBe(200);
  address = await get();
  expect(address).toMatchObject({ canPublish: true, canRelease: false });
  expect(address.reservations[0]).toMatchObject({
    public: true,
    privateOnly: false,
    url: "https://archer-game.apps.example/",
  });
  expect(
    (
      await delivery.dispatchHost(
        new Request("https://archer-game.apps.example/"),
      )
    ).status,
  ).toBe(302);
  grants.allowPublicApps = false;
  expect(
    (
      await delivery.dispatchHost(
        new Request("https://archer-game.apps.example/"),
      )
    ).status,
  ).toBe(401);
  expect((await delivery.dispatchHost(new Request(privateUrl))).status).toBe(
    302,
  );
  expect((await get()).reservations[0]).toMatchObject({
    public: false,
    privateOnly: true,
  });
  expect(
    (await post("address/release", { namespace: "apps.example" })).status,
  ).toBe(403);
});

it("opens a static app on the isolated artifact origin without starting any process", async () => {
  const info = await app.request(`/api/projects/${projectId}/app`);
  expect(await info.json()).toMatchObject({
    state: "ready",
    canExecute: false,
    canStart: true,
  });
  expect(await services.status(projectId)).toBeNull();
  const opened = await post("open", { target: "app", audience: "local" });
  expect(opened.status).toBe(200);
  const view = await opened.json();
  expect(view).toMatchObject({ kind: "static", transferable: true });
  expect(new URL(view.url).hostname).toBe("artifacts.localhost");
  expect(await (await artifacts.app.request(view.url)).text()).toBe(
    "<h1>Static starter</h1>",
  );
  // A view grant may start the app but not stop it. This static app has no
  // process, so an admitted start fails on the declaration, not on access.
  const started = await post("start");
  expect(started.status).not.toBe(403);
  expect(started.status).not.toBe(404);
  expect(await services.status(projectId)).toBeNull();
  expect((await post("stop")).status).toBe(403);
  grants.viewProjects = [];
  expect(
    (await post("open", { target: "app", audience: "local" })).status,
  ).toBe(404);
});

it("requires execution authority for live preview and rejects invalid start options", async () => {
  const start = vi.spyOn(services, "start").mockResolvedValue({
    generation: "preview-generation",
    declaration: {
      version: 1,
      where: { kind: "process", cwd: ".", entry: "/" },
      start: { argv: ["npm", "run", "dev"], portEnv: "PORT" },
      status: {
        probe: "http",
        path: "/",
        readyStatus: 200,
        startupTimeoutMs: 1000,
      },
      stop: { signal: "SIGTERM", graceMs: 1000 },
      serving: { target: "sandbox-loopback", protocol: "http" },
    },
    desired: "running",
    observed: "running",
    updatedAt: "2026-09-29T00:00:00.000Z",
    mode: "live-preview",
  });
  expect((await post("start", { mode: "live-preview" })).status).toBe(403);
  expect(start).not.toHaveBeenCalled();
  expect((await post("start", { mode: "unknown" })).status).toBe(400);
  grants.newSessionProjects = [projectId];
  expect((await post("start", { mode: "live-preview" })).status).toBe(200);
  expect(start).toHaveBeenCalledWith(
    projectId,
    projectPath,
    expect.any(Function),
    "live-preview",
  );
});

it("reports static entry changes and omits the stamp when the entry is missing", async () => {
  const entry = join(projectPath, "dist/index.html");
  const info = async () =>
    (await app.request(`/api/projects/${projectId}/app`)).json();
  for (const updatedAt of [
    "2026-09-28T10:00:00.000Z",
    "2026-09-28T11:00:00.000Z",
  ]) {
    await utimes(entry, new Date(updatedAt), new Date(updatedAt));
    expect(await info()).toMatchObject({ state: "ready", updatedAt });
  }
  await rm(entry);
  const missing = await info();
  expect(missing.state).toBe("missing");
  expect(missing).not.toHaveProperty("updatedAt");
});

it("reports the process runtime stamp, including an active service whose declaration changed", async () => {
  const declaration: ProjectServiceDeclaration = {
    version: 1,
    where: { kind: "process", cwd: ".", entry: "/" },
    start: { argv: ["node", "server.js"], portEnv: "PORT" },
    status: {
      probe: "http",
      path: "/",
      readyStatus: 200,
      startupTimeoutMs: 1000,
    },
    stop: { signal: "SIGTERM", graceMs: 1000 },
    serving: { target: "sandbox-loopback", protocol: "http" },
  };
  const updatedAt = "2026-09-28T12:00:00.000Z";
  vi.spyOn(services, "status").mockResolvedValue({
    declaration,
    generation: "process-generation",
    desired: "running",
    observed: "running",
    updatedAt,
  });
  await writeFile(
    join(projectPath, ".project-template/app.json"),
    JSON.stringify({ service: declaration }),
  );
  const info = async () =>
    (await app.request(`/api/projects/${projectId}/app`)).json();
  expect(await info()).toMatchObject({ state: "running", updatedAt });
  vi.spyOn(services, "ownsLaunch").mockReturnValue(true);
  await rm(join(projectPath, ".project-template/app.json"));
  expect(await info()).toMatchObject({
    state: "running",
    restartRequired: true,
    updatedAt,
  });
});

it("records publication order and renews an older viewed association after a new one arrives", async () => {
  const publishing = createArtifactRoutes({
    server: artifacts,
    scanner,
    locked: true,
    onArtifactCreated: async (path, id) => {
      if (id) await store.associate(id, path);
    },
  });
  for (const name of ["first", "second"]) {
    await writeFile(join(projectPath, `${name}.html`), `<h1>${name}</h1>`);
    const response = await publishing.request("/artifacts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        projectId,
        path: `${name}.html`,
        audience: "local",
      }),
    });
    expect(response.status).toBe(200);
  }
  const latest = await store.latestArtifact(projectId);
  expect(latest?.path).toBe(join(projectPath, "second.html"));
  // Keep the current identity, then publish another file while its viewer remains open.
  const viewed = latest!;
  await writeFile(join(projectPath, "third.html"), "<h1>third</h1>");
  await store.associate(projectId, join(projectPath, "third.html"));
  const renewed = await post("open", {
    target: "artifact",
    artifactId: viewed.id,
    audience: "local",
  });
  expect(renewed.status).toBe(200);
  expect(
    await (await artifacts.app.request((await renewed.json()).url)).text(),
  ).toBe("<h1>second</h1>");
});

it("rejects arbitrary paths and symlink escapes even if host-wide artifact policy would allow them", async () => {
  const outside = join(root, "outside.html");
  await writeFile(outside, "private");
  await store.associate(projectId, outside);
  expect(
    (await post("open", { target: "artifact", audience: "local" })).status,
  ).toBe(403);
  expect(
    (
      await post("open", {
        target: "artifact",
        audience: "local",
        path: outside,
      })
    ).status,
  ).toBe(400);
  await rm(join(projectPath, "dist/index.html"));
  await symlink(outside, join(projectPath, "dist/index.html"));
  expect((await app.request(`/api/projects/${projectId}/app`)).status).toBe(
    200,
  );
  expect(
    (await post("open", { target: "app", audience: "local" })).status,
  ).not.toBe(200);
});

it("keeps other users' hide history private and permits administrator restoration", async () => {
  await store.setHidden(projectId, "archer", true, "archer");
  expect(
    await (await app.request(`/api/projects/${projectId}/app`)).json(),
  ).toMatchObject({ removedFrom: [] });
  expect((await post("restore", { username: "archer" })).status).toBe(403);
  principal = { kind: "superuser" };
  expect(
    await (await app.request(`/api/projects/${projectId}/app`)).json(),
  ).toMatchObject({ removedFrom: [{ username: "archer" }] });
  expect((await post("restore", { username: "archer" })).status).toBe(200);
  expect(await store.hiddenProjectIds("archer")).toEqual(new Set());
});

it("adapts the existing static canvas declaration and preserves a declared nested entry's asset root", async () => {
  await writeFile(
    join(projectPath, ".project-template/app.json"),
    JSON.stringify({ kind: "static", dir: "dist" }),
  );
  expect(
    (await post("open", { target: "app", audience: "local" })).status,
  ).toBe(200);
  await mkdir(join(projectPath, "dist/pages"));
  await writeFile(
    join(projectPath, "dist/pages/index.html"),
    '<script src="../asset.js"></script>',
  );
  await writeFile(join(projectPath, "dist/asset.js"), "window.loaded = true;");
  await writeFile(
    join(projectPath, ".project-template/app.json"),
    JSON.stringify({
      service: {
        version: 1,
        where: { kind: "static", root: "dist", entry: "pages/index.html" },
        serving: { target: "static-root" },
      },
    }),
  );
  const view = await (
    await post("open", { target: "app", audience: "local" })
  ).json();
  expect(new URL(view.url).pathname).toMatch(/\/pages\/index.html$/);
  expect(
    await (
      await artifacts.app.request(new URL("../asset.js", view.url))
    ).text(),
  ).toBe("window.loaded = true;");
});

it("gates reservations, prefixes limited claims, and separates claiming from administrator publication", async () => {
  const get = () => app.request(`/api/projects/${projectId}/app/address`);
  expect(await (await get()).json()).toMatchObject({
    enabled: false,
    reservations: [],
  });
  expect(
    (await post("address/reserve", { name: "archer-canvas" })).status,
  ).toBe(403);
  grants.newSessionProjects = [projectId];
  expect(
    (await post("address/reserve", { name: "archer-canvas" })).status,
  ).toBe(409);
  // No listener is needed to verify reservation routing/configuration.
  artifacts.config.vhostPublicRoot = "apps.example";
  expect(
    (await post("address/reserve", { name: "someone-canvas" })).status,
  ).toBe(403);
  expect((await post("address/reserve", { name: "app-stolen" })).status).toBe(
    400,
  );
  expect(
    (await post("address/reserve", { name: "archer-canvas" })).status,
  ).toBe(200);
  expect(await services.status(projectId)).toBeNull();
  expect(await (await get()).json()).toMatchObject({
    reservations: [{ name: "archer-canvas", serving: false, public: false }],
  });
  expect(
    (await post("address/serve", { serving: true, public: false })).status,
  ).toBe(403);
  expect(
    (await post("address/release", { namespace: "apps.example" })).status,
  ).toBe(403);
  principal = { kind: "superuser" };
  const target = { name: "archer-canvas", projectId };
  const oldToken = artifacts.vhostAccess.token(target);
  // The owner lacks public-app permission; the superuser is not capped by it.
  expect(
    (await post("address/serve", { serving: true, public: true })).status,
  ).toBe(200);
  expect((await (await get()).json()).reservations[0]).toMatchObject({
    public: true,
    privateOnly: false,
  });
  expect(
    (
      await delivery.dispatchHost(
        new Request("https://archer-canvas.apps.example/"),
      )
    ).status,
  ).not.toBe(401);
  expect(
    (await post("address/serve", { serving: true, public: false })).status,
  ).toBe(200);
  expect(await store.reservations(projectId)).toMatchObject([
    { public: false, superuserPublic: false },
  ]);
  expect(
    (
      await delivery.dispatchHost(
        new Request("https://archer-canvas.apps.example/"),
      )
    ).status,
  ).toBe(401);
  artifacts.config.vhostPublicRoot = "new.example";
  expect(await (await get()).json()).toMatchObject({
    namespace: "new.example",
    reservations: [{ namespace: "apps.example", name: "archer-canvas" }],
  });
  expect(
    (await post("address/release", { namespace: "apps.example" })).status,
  ).toBe(200);
  expect(await store.reservations(projectId)).toEqual([]);
  expect(artifacts.vhostAccess.token(target)).not.toBe(oldToken);
});
