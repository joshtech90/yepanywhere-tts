import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { ArtifactServer } from "../../src/artifacts/ArtifactServer.js";
import { validateArtifactConfig } from "../../src/artifacts/config.js";
import {
  clientVhostSite,
  hashVhostPassword,
} from "../../src/artifacts/vhosts.js";
import { createArtifactConfigWriter } from "../../src/routes/artifactConfigWriter.js";
import { createVhostSiteRoutes } from "../../src/routes/vhostSites.js";
import { createLocalResourcePathPolicy } from "../../src/routes/local-resource-policy.js";
import { ServerSettingsService } from "../../src/services/ServerSettingsService.js";

const cleanup: string[] = [];
const servers: ArtifactServer[] = [];
afterEach(async () => {
  for (const server of servers.splice(0)) await server.close();
  for (const path of cleanup.splice(0)) await rm(path, { recursive: true });
});

async function site() {
  const directory = await mkdtemp(join(tmpdir(), "ya-vhost-site-"));
  cleanup.push(directory);
  await mkdir(join(directory, "assets"));
  await mkdir(join(directory, "docs"));
  await writeFile(
    join(directory, "page.html"),
    '<link rel="stylesheet" href="/assets/app.css"><a href="secret.txt">x</a>',
  );
  await writeFile(join(directory, "assets", "app.css"), "body{}");
  await writeFile(join(directory, "secret.txt"), "private");
  await writeFile(join(directory, "docs", "index.html"), "<h1>Docs</h1>");
  await writeFile(join(directory, ".env"), "TOKEN=1");
  return directory;
}

/** A port nothing listens on, since a public root starts the listener. */
async function freePort(): Promise<number> {
  const probe = createServer();
  await new Promise<void>((resolve) => probe.listen(0, "127.0.0.1", resolve));
  const { port } = probe.address() as AddressInfo;
  await new Promise((resolve) => probe.close(resolve));
  return port;
}

async function server(directory: string, vhostSites: unknown[]) {
  const port = await freePort();
  const artifacts = new ArtifactServer(
    validateArtifactConfig({
      port,
      localOrigin: `http://artifacts.localhost:${port}`,
      vhostPublicRoot: "example.org",
      vhostSites,
    }),
    createLocalResourcePathPolicy({ allowedPaths: [directory] }),
    { stateDir: join(directory, ".state") },
  );
  servers.push(artifacts);
  return artifacts;
}

const get = (artifacts: ArtifactServer, url: string, init?: RequestInit) =>
  artifacts.dispatchHost(new Request(url, init)) as Promise<Response>;

it("serves a file at / and only the assets its HTML loads", async () => {
  const directory = await site();
  const artifacts = await server(directory, [
    { name: "page", path: join(directory, "page.html"), public: true },
  ]);
  const root = await get(artifacts, "https://page.example.org/");
  expect(root.status).toBe(200);
  expect(await root.text()).toContain("app.css");
  expect(root.headers.get("content-security-policy")).toContain("sandbox");
  expect(root.headers.get("cache-control")).toBe("no-store");
  const css = await get(artifacts, "http://page.localhost/assets/app.css");
  expect(css.status).toBe(200);
  expect(css.headers.get("content-type")).toContain("text/css");
  // A linked document is not an asset, and nothing escapes the site root.
  for (const path of ["/secret.txt", "/.env", "/../page.html", "/%2e%2e/x"])
    expect(
      (await get(artifacts, `https://page.example.org${path}`)).status,
    ).toBeGreaterThanOrEqual(400);
  expect(await get(artifacts, "https://other.example.org/")).toBeNull();
});

it("serves a directory with index pages and never dotfiles", async () => {
  const directory = await site();
  const artifacts = await server(directory, [
    { name: "tree", path: directory, public: true },
  ]);
  expect(
    await (await get(artifacts, "https://tree.example.org/secret.txt")).text(),
  ).toBe("private");
  const folder = await get(artifacts, "https://tree.example.org/docs");
  expect(folder.status).toBe(308);
  expect(folder.headers.get("location")).toBe("/docs/");
  expect(
    await (await get(artifacts, "https://tree.example.org/docs/")).text(),
  ).toBe("<h1>Docs</h1>");
  expect((await get(artifacts, "https://tree.example.org/.env")).status).toBe(
    400,
  );
  expect(
    (await get(artifacts, "https://tree.example.org/x", { method: "POST" }))
      .status,
  ).toBe(405);
});

it("requires the link for a private row and the password for a protected one", async () => {
  const directory = await site();
  const path = join(directory, "page.html");
  const artifacts = await server(directory, [
    { name: "private", path },
    { name: "locked", path, public: true, password: "open sesame" },
  ]);
  await artifacts.ready;
  expect((await get(artifacts, "https://private.example.org/")).status).toBe(
    401,
  );
  const [privateRow, lockedRow] = artifacts.config.vhostSites!;
  const token = artifacts.vhostAccess.token(privateRow!);
  expect(
    (await get(artifacts, `https://private.example.org/?ya_access=${token}`))
      .status,
  ).toBe(200);

  const challenge = await get(artifacts, "https://locked.example.org/");
  expect(challenge.status).toBe(401);
  expect(challenge.headers.get("www-authenticate")).toContain("Basic");
  const basic = (password: string) => ({
    headers: {
      authorization: `Basic ${Buffer.from(`any:${password}`).toString("base64")}`,
    },
  });
  expect(
    (await get(artifacts, "https://locked.example.org/", basic("wrong")))
      .status,
  ).toBe(401);
  const opened = await get(
    artifacts,
    "https://locked.example.org/",
    basic("open sesame"),
  );
  expect(opened.status).toBe(200);
  // The password earns the app cookie, so assets skip the slow check.
  const cookie = opened.headers.get("set-cookie")!.split(";")[0]!;
  expect(
    (
      await get(artifacts, "https://locked.example.org/assets/app.css", {
        headers: { cookie },
      })
    ).status,
  ).toBe(200);
  // An app link still opens it without the password.
  expect(
    (
      await get(
        artifacts,
        `https://locked.example.org/?ya_access=${artifacts.vhostAccess.token(lockedRow!)}`,
      )
    ).status,
  ).toBe(200);
  expect(clientVhostSite(lockedRow!)).toEqual({
    name: "locked",
    path,
    public: true,
    passwordProtected: true,
  });
});

it("keeps names unique across rows, keeps a saved password, and resets it", () => {
  const hash = hashVhostPassword("first");
  const base = { port: 4402, vhosts: [{ name: "plan", port: 19432 }] };
  expect(() =>
    validateArtifactConfig({
      ...base,
      vhostSites: [{ name: "plan", path: "/tmp/a" }],
    }),
  ).toThrow(/Duplicate/);
  for (const name of ["ya", "relay", "app-x", "sbx-y"])
    expect(() =>
      validateArtifactConfig({ ...base, vhostSites: [{ name, path: "/a" }] }),
    ).toThrow(/Invalid vhost name/);
  const previous = [
    { name: "page", path: "/a", public: true, passwordHash: hash },
  ];
  const kept = validateArtifactConfig(
    { ...base, vhostSites: [{ name: "page", path: "/a", public: true }] },
    undefined,
    { vhostSites: previous },
  );
  expect(kept.vhostSites?.[0]?.passwordHash).toBe(hash);
  const reset = validateArtifactConfig(
    {
      ...base,
      vhostSites: [{ name: "page", path: "/a", public: true, password: "new" }],
    },
    undefined,
    { vhostSites: previous },
  );
  expect(reset.vhostSites?.[0]?.passwordHash).not.toBe(hash);
  const cleared = validateArtifactConfig(
    {
      ...base,
      vhostSites: [{ name: "page", path: "/a", public: true, password: "" }],
    },
    undefined,
    { vhostSites: previous },
  );
  expect(cleared.vhostSites?.[0]?.passwordHash).toBeUndefined();
  // A client that predates file rows keeps them by omitting the list.
  expect(
    validateArtifactConfig(base, undefined, { vhostSites: previous })
      .vhostSites,
  ).toEqual(previous);
});

it("claims a name first come, first served and releases it", async () => {
  const directory = await site();
  const dataDir = join(directory, ".data");
  const settings = new ServerSettingsService({ dataDir });
  await settings.initialize();
  const artifacts = await server(directory, []);
  const routes = createVhostSiteRoutes({
    server: artifacts,
    scanner: { getProject: async () => null },
    writer: createArtifactConfigWriter({
      server: artifacts,
      settings,
      locked: false,
    }),
  });
  const claim = (name: string, path = join(directory, "page.html")) =>
    routes.request("/artifacts/vhost-sites", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, path, public: true }),
    });
  const first = await claim("garden");
  expect(first.status).toBe(200);
  expect(await first.json()).toMatchObject({
    name: "garden",
    kind: "file",
    publicUrl: "https://garden.example.org/",
    localUrl: `http://garden.localhost:${artifacts.config.port}/`,
  });
  expect((await claim("garden", directory)).status).toBe(409);
  expect((await claim("relay")).status).toBe(400);
  expect((await claim("elsewhere", "/nonexistent/page.html")).status).toBe(404);
  const listed = await routes.request(
    `/artifacts/vhost-sites?path=${encodeURIComponent(join(directory, "page.html"))}`,
  );
  expect((await listed.json()).sites).toHaveLength(1);
  expect(settings.getSetting("artifactViewer")?.vhostSites).toHaveLength(1);
  const released = await routes.request("/artifacts/vhost-sites/garden", {
    method: "DELETE",
  });
  expect(released.status).toBe(200);
  expect((await claim("garden", directory)).status).toBe(200);
});
