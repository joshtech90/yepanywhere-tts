import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  appendFile,
  cp,
  copyFile,
  mkdir,
  mkdtemp,
  rm,
  writeFile,
} from "node:fs/promises";
import { createServer, request, type IncomingHttpHeaders } from "node:http";
import { createServer as createHttpsServer } from "node:https";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import { createServer as createViteServer } from "vite";
import { checkMockup } from "./fixtures/mockup-checks";
import { viewports } from "../mockups/export";
import { createRelayServer } from "../../relay/src/server";
import { AuthService } from "../../server/src/auth/AuthService";
import { ensureSelfSignedCertificate } from "../../server/src/https/self-signed";
import { initFileAccess } from "../../server/src/middleware/file-access";
import {
  RemoteAccessService,
  RemoteSessionService,
} from "../../server/src/remote-access";
import { createAcceptRelayConnection } from "../../server/src/routes/ws-relay";
import { MockClaudeSDK } from "../../server/src/sdk/mock";
import { RelayClientService } from "../../server/src/services/RelayClientService";
import { ServerSettingsService } from "../../server/src/services/ServerSettingsService";
import { UploadManager } from "../../server/src/uploads/manager";
import { EventBus } from "../../server/src/watcher";
import { createApp } from "../../server/test/setup/create-app";

// The dedicated gateway below uses a generated, self-signed test certificate.
test.use({ ignoreHTTPSErrors: true });

const clientRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const serverRequire = createRequire(join(clientRoot, "../server/package.json"));
const username = "artifact-relay-test";
const password = "artifact-relay-test-password";
let directory: string;
let vite: Awaited<ReturnType<typeof createViteServer>>;
let relay: Awaited<ReturnType<typeof createRelayServer>>;
let gateway: ReturnType<typeof createHttpsServer>;
let instance: ReturnType<typeof createApp>;
let remoteSessions: RemoteSessionService;
let relayClient: RelayClientService;
let clientOrigin: string;
let artifactOrigin: string;
let relayUrl: string;
let projectId: string;
let linkedArtifactUrl: string;
const artifactRequests: { path: string; headers: IncomingHttpHeaders }[] = [];

test.beforeAll(async () => {
  test.skip(
    spawnSync("openssl", ["version"]).status !== 0,
    "The isolated HTTPS gateway requires OpenSSL on PATH.",
  );
  const scratch = resolve(clientRoot, "../../.artifacts/artifact-relay");
  await mkdir(scratch, { recursive: true });
  directory = await mkdtemp(join(scratch, "run-"));
  const bundle = join(directory, "bundle");
  await cp(resolve(clientRoot, "../server/test/fixtures/artifact"), bundle, {
    recursive: true,
  });
  await copyFile(
    join(
      dirname(serverRequire.resolve("katex/package.json")),
      "dist/fonts/KaTeX_Main-Regular.woff2",
    ),
    join(bundle, "font.woff2"),
  );
  const projectsDir = join(directory, "sessions");
  const sessionDir = join(
    projectsDir,
    "localhost",
    bundle.replaceAll(/[/\\:]/g, "-"),
  );
  await mkdir(sessionDir, { recursive: true });
  await writeFile(
    join(sessionDir, "artifact-session.jsonl"),
    `${JSON.stringify({
      type: "user",
      uuid: randomUUID(),
      sessionId: "artifact-session",
      cwd: bundle,
      timestamp: new Date().toISOString(),
      message: { role: "user", content: "Review the artifact" },
    })}\n`,
  );
  const dataDir = join(directory, "data");
  const settings = new ServerSettingsService({ dataDir });
  await settings.initialize();
  initFileAccess({
    uploadsDir: directory,
    homeDir: directory,
    tempPaths: [directory],
    envPaths: [directory],
  });
  vite = await createViteServer({
    root: clientRoot,
    cacheDir: join(directory, "node_modules", ".vite"),
    configFile: join(clientRoot, "vite.config.remote.ts"),
    server: { host: "127.0.0.1", port: 0, strictPort: false },
  });
  await vite.listen();
  const viteAddress = vite.httpServer?.address();
  if (!viteAddress || typeof viteAddress === "string")
    throw new Error("Missing hosted-client port");
  clientOrigin = `http://viewer.localhost:${viteAddress.port}`;
  relay = await createRelayServer({
    inMemoryDb: true,
    disablePrettyPrint: true,
    disableTelemetry: true,
    allowedOrigins: clientOrigin,
  });
  relayUrl = `ws://localhost:${relay.port}/ws`;
  const remoteAccess = new RemoteAccessService({ dataDir });
  await remoteAccess.initialize();
  await remoteAccess.setRelayConfig({ url: relayUrl, username });
  await remoteAccess.configure(password);
  remoteSessions = new RemoteSessionService({ dataDir });
  await remoteSessions.initialize();
  relayClient = new RelayClientService();
  const eventBus = new EventBus();
  const authService = new AuthService({ dataDir, cookieSecret: randomUUID() });
  await authService.initialize();
  instance = createApp({
    authService,
    authDisabled: true,
    enabledProviders: ["claude"],
    sdk: new MockClaudeSDK(),
    dataDir,
    projectsDir,
    eventBus,
    serverSettingsService: settings,
    remoteAccessService: remoteAccess,
    remoteSessionService: remoteSessions,
    relayClientService: relayClient,
  });
  const project = (await instance.scanner.listProjects()).find(
    (candidate) => candidate.path === bundle,
  );
  if (!project) throw new Error("Missing artifact project");
  projectId = project.id;
  const certificate = ensureSelfSignedCertificate({
    dataDir,
    host: "artifacts.localhost",
  });
  gateway = createHttpsServer(certificate, (incoming, outgoing) => {
    artifactRequests.push({
      path: incoming.url ?? "",
      headers: incoming.headers,
    });
    const upstream = request(
      {
        hostname: "127.0.0.1",
        port: instance.artifactServer.config.port,
        method: incoming.method,
        path: incoming.url,
        headers: incoming.headers,
      },
      (response) => {
        outgoing.writeHead(response.statusCode ?? 502, response.headers);
        response.pipe(outgoing);
      },
    );
    upstream.on("error", (error) => outgoing.destroy(error));
    incoming.pipe(upstream);
  });
  await new Promise<void>((ready) => gateway.listen(0, "127.0.0.1", ready));
  const address = gateway.address();
  if (!address || typeof address === "string")
    throw new Error("Missing HTTPS gateway port");
  artifactOrigin = `https://artifacts.localhost:${address.port}`;
  const reservation = createServer();
  await new Promise<void>((ready) => reservation.listen(0, "127.0.0.1", ready));
  const reserved = reservation.address();
  if (!reserved || typeof reserved === "string")
    throw new Error("Missing artifact listener port");
  await new Promise<void>((done, reject) =>
    reservation.close((error) => (error ? reject(error) : done())),
  );
  await instance.artifactServer.configure({
    port: reserved.port,
    publicOrigin: artifactOrigin,
  });
  const grantResponse = await instance.app.request("/api/artifacts", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Yep-Anywhere": "true" },
    body: JSON.stringify({ projectId, path: "index.html", audience: "public" }),
  });
  expect(grantResponse.status).toBe(200);
  linkedArtifactUrl = (await grantResponse.json()).url;
  await appendFile(
    join(sessionDir, "artifact-session.jsonl"),
    `${JSON.stringify({
      type: "assistant",
      uuid: randomUUID(),
      sessionId: "artifact-session",
      cwd: bundle,
      timestamp: new Date().toISOString(),
      message: {
        role: "assistant",
        content: [
          {
            type: "text",
            text: `[Open interactive artifact](${linkedArtifactUrl})`,
          },
        ],
      },
    })}\n`,
  );
  relayClient.start({
    relayUrl,
    username,
    installId: randomUUID(),
    onRelayConnection: createAcceptRelayConnection({
      app: instance.app,
      baseUrl: "http://localhost:3400",
      supervisor: instance.supervisor,
      eventBus,
      remoteAccessService: remoteAccess,
      remoteSessionService: remoteSessions,
      uploadManager: new UploadManager({
        uploadsDir: join(directory, "uploads"),
      }),
    }),
  });
  await expect.poll(() => relayClient.getState().status).toBe("waiting");
});

test.afterAll(async () => {
  relayClient?.stop();
  if (relay) await relay.close();
  remoteSessions?.shutdown();
  if (gateway) {
    gateway.closeAllConnections();
    await new Promise<void>((done, reject) =>
      gateway.close((error) => (error ? reject(error) : done())),
    );
  }
  if (instance) await instance.disposeSessionReaders();
  if (vite) await vite.close();
  if (directory) await rm(directory, { recursive: true });
});

test("opens original interactive files through relay grants and a separate HTTPS origin", async ({
  page,
  context,
}) => {
  const problems: string[] = [];
  const directGrantRequests: string[] = [];
  page.on("pageerror", (error) => problems.push(error.message));
  page.on("request", (request) => {
    if (new URL(request.url()).pathname.startsWith("/api/artifacts"))
      directGrantRequests.push(request.url());
  });
  await context.addCookies([
    { name: "ya_test_session", value: "private-cookie", url: clientOrigin },
  ]);
  await page.setViewportSize({ width: 1000, height: 600 });
  await page.goto(clientOrigin);
  await page.evaluate(() =>
    localStorage.setItem("ya-test-secret", "private-storage"),
  );
  await page.getByTestId("relay-mode-button").click();
  await page.getByTestId("relay-username-input").fill(username);
  await page.getByTestId("srp-password-input").fill(password);
  await page.getByText("Show Advanced Options", { exact: true }).click();
  await page.getByTestId("custom-relay-url-input").fill(relayUrl);
  await page.getByTestId("login-button").click();
  await expect(page.getByTestId("relay-login-form")).not.toBeVisible({
    timeout: 15000,
  });
  const fileResponse = await page.goto(
    `${clientOrigin}/-/relay/${username}/projects/${projectId}/file?path=index.html`,
  );
  expect(await fileResponse?.text()).toContain("/src/remote-main.tsx");
  expect(artifactRequests).toEqual([]);
  await page
    .locator(".file-viewer-header")
    .getByRole("button", { name: "Raw source", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Run interactive preview" }),
  ).toHaveCount(0);
  const frame = page.frameLocator("iframe");
  await expect(frame.getByRole("status")).toHaveText("3 sample notes");
  const child = page
    .frames()
    .find((candidate) => candidate.url().startsWith(`${artifactOrigin}/a/`));
  if (!child) throw new Error("Missing interactive artifact frame");
  const grantUrl = child.url();
  await frame.getByRole("button", { name: "Menu", exact: true }).click();
  await frame
    .getByPlaceholder("Write something")
    .fill("Saved through the relay viewer");
  await frame.getByRole("button", { name: "Save note" }).click();
  await expect(frame.getByRole("status")).toHaveText("Note saved");
  expect(
    await child.evaluate(async () => {
      await document.fonts.ready;
      let parentBlocked = false;
      try {
        void parent.document.title;
      } catch {
        parentBlocked = true;
      }
      return {
        font: document.fonts.check("17px ArtifactFont"),
        parentBlocked,
        hostSecret: localStorage.getItem("ya-test-secret"),
        note: localStorage.getItem("artifact-note"),
        apiStatus: (await fetch("/api/version")).status,
      };
    }),
  ).toEqual({
    font: true,
    parentBlocked: true,
    hostSecret: null,
    note: "Saved through the relay viewer",
    apiStatus: 404,
  });
  const captures = resolve(
    clientRoot,
    "../../.artifacts/ui-testing/2026-09-07-artifact-relay",
  );
  await mkdir(captures, { recursive: true });
  await child.evaluate(() => window.scrollTo(0, 0));
  const desktopFrame = await page.locator("iframe").boundingBox();
  expect(desktopFrame?.height).toBeGreaterThan(400);
  await page.screenshot({ path: join(captures, "desktop.png") });
  await page.setViewportSize({ width: 375, height: 812 });
  await child.evaluate(() => window.scrollTo(0, 0));
  const phoneFrame = await page.locator("iframe").boundingBox();
  expect(phoneFrame?.height).toBeGreaterThan(600);
  await page.screenshot({ path: join(captures, "phone.png") });
  await frame.getByRole("link", { name: "Project details" }).click();
  await expect(
    frame.getByRole("heading", { name: "Project details" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Raw source", exact: true }).click();
  await expect
    .poll(
      async () => (await instance.artifactServer.app.request(grantUrl)).status,
    )
    .toBe(404);
  expect(directGrantRequests).toEqual([]);
  expect(artifactRequests[0]?.path).toBe("/health");
  expect(
    artifactRequests.some((request) => request.path.endsWith("/font.woff2")),
  ).toBe(true);
  expect(
    artifactRequests.some((request) => request.path.endsWith("/notes.js")),
  ).toBe(true);
  for (const request of artifactRequests) {
    expect(request.headers.cookie).toBeUndefined();
    expect(request.headers.authorization).toBeUndefined();
    expect(request.headers["x-yep-anywhere"]).toBeUndefined();
    expect(request.headers.referer).toBeUndefined();
  }
  expect(problems).toEqual([]);
});

test("runs the generated YA mockup through the hosted relay viewer", async ({
  page,
}) => {
  const bundle = join(directory, "bundle", "mockup");
  const built = spawnSync(
    process.execPath,
    [
      join(dirname(serverRequire.resolve("vite/package.json")), "bin/vite.js"),
      "build",
      "--config",
      "vite.config.mockup.ts",
      "--outDir",
      bundle,
    ],
    {
      cwd: clientRoot,
      env: { ...process.env, NODE_ENV: "production" },
      encoding: "utf8",
    },
  );
  expect(
    built.status,
    built.error?.message ?? built.stdout + built.stderr,
  ).toBe(0);
  const problems: string[] = [];
  const directGrants: string[] = [];
  const requestStart = artifactRequests.length;
  page.on("pageerror", (error) => problems.push(error.message));
  page.on("request", (request) => {
    if (new URL(request.url()).pathname.startsWith("/api/artifacts"))
      directGrants.push(request.url());
  });
  await page.goto(clientOrigin);
  await page.getByTestId("relay-mode-button").click();
  await page.getByTestId("relay-username-input").fill(username);
  await page.getByTestId("srp-password-input").fill(password);
  await page.getByText("Show Advanced Options", { exact: true }).click();
  await page.getByTestId("custom-relay-url-input").fill(relayUrl);
  await page.getByTestId("login-button").click();
  await expect(page.getByTestId("relay-login-form")).not.toBeVisible({
    timeout: 15000,
  });
  await page.goto(
    `${clientOrigin}/-/relay/${username}/projects/${projectId}/file?path=mockup/index.html`,
  );
  await page.getByRole("button", { name: "Raw source", exact: true }).click();
  await expect(
    page
      .frameLocator("iframe")
      .getByRole("heading", { name: "Project review", exact: true }),
  ).toBeVisible();
  const child = page
    .frames()
    .find((frame) => frame.url().startsWith(`${artifactOrigin}/a/`));
  if (!child) throw new Error("Missing mockup frame");
  await page.setViewportSize(viewports[0]!);
  await checkMockup(child, "default");
  await child
    .getByRole("button", { name: "Project settings", exact: true })
    .first()
    .click();
  await child.getByRole("menuitem", { name: "Project settings" }).click();
  await expect(child.getByRole("status")).toHaveText(
    "Settings selected: Yep Anywhere",
  );
  const captures = resolve(
    clientRoot,
    "../../.artifacts/mockups/captures/projects",
  );
  await mkdir(captures, { recursive: true });
  for (const viewport of viewports) {
    await page.setViewportSize(viewport);
    await checkMockup(child, "selected");
    await page.screenshot({
      path: join(captures, `relay-${viewport.name}.png`),
    });
  }
  await child
    .getByRole("button", { name: "New session", exact: true })
    .first()
    .click();
  await expect(child.getByRole("status")).toContainText(
    "Preview navigation: /new-session?projectId=fixture-0",
  );
  const requests = artifactRequests.slice(requestStart);
  expect(
    requests.some((request) =>
      /\/inter-latin-400-normal-.*\.woff2$/.test(request.path),
    ),
  ).toBe(true);
  expect(
    requests.some((request) => /\/react-runtime-.*\.js$/.test(request.path)),
  ).toBe(true);
  for (const request of requests) {
    expect(request.headers.cookie).toBeUndefined();
    expect(request.headers.authorization).toBeUndefined();
    expect(request.headers.referer).toBeUndefined();
  }
  expect(directGrants).toEqual([]);
  expect(problems).toEqual([]);
  const grantUrl = child.url();
  await page.getByRole("button", { name: "Raw source", exact: true }).click();
  await expect
    .poll(
      async () => (await instance.artifactServer.app.request(grantUrl)).status,
    )
    .toBe(404);
  // Reproduce the stale localhost document policy, then exercise the real
  // top-level fallback without changing or weakening either origin's CSP.
  await page.evaluate(() => {
    const policy = document.createElement("meta");
    policy.httpEquiv = "Content-Security-Policy";
    policy.content = "frame-src 'self'";
    document.head.append(policy);
  });
  await page.getByRole("button", { name: "Raw source", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("browser policy blocked");
  await expect(page.locator("iframe")).toHaveCount(0);
  for (const viewport of viewports) {
    await page.setViewportSize(viewport);
    await page.screenshot({
      path: join(captures, `blocked-${viewport.name}.png`),
    });
  }
  const opened = page.waitForEvent("popup");
  await page
    .getByRole("link", { name: "Open interactive preview in a new tab" })
    .click();
  const popup = await opened;
  await popup.setViewportSize(viewports[0]!);
  await checkMockup(popup, "default");
  expect(await popup.evaluate(() => window.opener === null)).toBe(true);
  const fallbackUrl = popup.url();
  await popup.close();
  await page.getByRole("button", { name: "Raw source", exact: true }).click();
  await expect
    .poll(
      async () =>
        (await instance.artifactServer.app.request(fallbackUrl)).status,
    )
    .toBe(404);
});

test("keeps the mobile session mounted through artifact open, park, and Back", async ({
  page,
  context,
}) => {
  await page.goto(clientOrigin);
  await page.getByTestId("relay-mode-button").click();
  await page.getByTestId("relay-username-input").fill(username);
  await page.getByTestId("srp-password-input").fill(password);
  await page.getByText("Show Advanced Options", { exact: true }).click();
  await page.getByTestId("custom-relay-url-input").fill(relayUrl);
  await page.getByTestId("login-button").click();
  await expect(page.getByTestId("relay-login-form")).not.toBeVisible({
    timeout: 15000,
  });
  const sessionUrl = `${clientOrigin}/-/relay/${username}/projects/${projectId}/sessions/artifact-session`;
  const idleRequests = artifactRequests.length;
  await page.goto(sessionUrl);
  const composer = page.getByRole("textbox", {
    name: "Send a message to resume...",
    exact: true,
  });
  await expect(composer).toBeVisible({ timeout: 30000 });
  await composer.fill("Keep this draft and mounted session");
  await expect(page.locator("iframe")).toHaveCount(0);
  expect(artifactRequests).toHaveLength(idleRequests);
  const sessionNode = await page.locator(".session-page").elementHandle();
  const composerNode = await composer.elementHandle();
  const transcriptNode = await page.locator(".message-list").elementHandle();
  const problems: string[] = [];
  page.on("pageerror", (error) => problems.push(error.message));
  const documents: string[] = [];
  page.on("request", (request) => {
    if (request.isNavigationRequest() && request.frame() === page.mainFrame())
      documents.push(request.url());
  });
  const captures = resolve(
    clientRoot,
    "../../.artifacts/ui-testing/2026-09-07-mounted-artifact",
  );
  await mkdir(captures, { recursive: true });
  for (const viewport of viewports) {
    await page.setViewportSize(viewport);
    await page
      .getByRole("link", { name: "Open interactive artifact", exact: true })
      .click();
    const viewer = page.getByRole("dialog", {
      name: "Open interactive artifact",
    });
    await expect(viewer).toBeVisible();
    const frame = page.frameLocator("iframe");
    await expect(frame.getByRole("status")).toHaveText("3 sample notes");
    await frame.getByRole("button", { name: "Menu", exact: true }).click();
    await frame.getByPlaceholder("Write something").fill("Keep artifact state");
    const iframe = await page.locator("iframe").elementHandle();
    await viewer.getByRole("button", { name: "Minimize", exact: true }).click();
    await expect(viewer).not.toBeVisible();
    await expect(composer).toHaveValue("Keep this draft and mounted session");
    await page
      .getByRole("button", {
        name: "Restore detail view: Open interactive artifact",
        exact: true,
      })
      .click();
    await expect(viewer).toBeVisible();
    expect(
      await iframe?.evaluate(
        (node) => node === document.querySelector("iframe"),
      ),
    ).toBe(true);
    await expect(frame.getByPlaceholder("Write something")).toHaveValue(
      "Keep artifact state",
    );
    await viewer.getByRole("button", { name: "Minimize", exact: true }).click();
    await page
      .getByRole("link", { name: "Open interactive artifact", exact: true })
      .click();
    await expect(viewer).toBeVisible();
    await expect(frame.getByPlaceholder("Write something")).toHaveValue(
      "Keep artifact state",
    );
    const viewerBox = await viewer.boundingBox();
    const composerBox = await page.locator(".session-input").boundingBox();
    expect(viewerBox).not.toBeNull();
    expect(composerBox).not.toBeNull();
    expect(viewerBox!.y + viewerBox!.height).toBeLessThanOrEqual(
      composerBox!.y + 1,
    );
    await page.screenshot({ path: join(captures, `${viewport.name}.png`) });
    await viewer.getByRole("button", { name: "Close", exact: true }).click();
    await expect(viewer).toHaveCount(0);
    await expect
      .poll(() => page.evaluate(() => window.history.state?.__artifactViewer))
      .toBeUndefined();
    await page
      .getByRole("link", { name: "Open interactive artifact", exact: true })
      .click();
    await expect(viewer).toBeVisible();
    await page.goBack();
    await expect(viewer).toHaveCount(0);
    expect(
      await sessionNode?.evaluate(
        (node) => node === document.querySelector(".session-page"),
      ),
    ).toBe(true);
    expect(
      await composerNode?.evaluate(
        (node) => node === document.querySelector(".session-input textarea"),
      ),
    ).toBe(true);
    expect(
      await transcriptNode?.evaluate(
        (node) => node === document.querySelector(".message-list"),
      ),
    ).toBe(true);
    await expect(composer).toHaveValue("Keep this draft and mounted session");
    expect(page.url()).toBe(sessionUrl);
    expect(context.pages()).toHaveLength(1);
  }
  expect(documents).toEqual([]);
  expect(problems).toEqual([]);
  await page.evaluate(() => {
    const policy = document.createElement("meta");
    policy.httpEquiv = "Content-Security-Policy";
    policy.content = "frame-src 'self'";
    document.head.append(policy);
  });
  await page
    .getByRole("link", { name: "Open interactive artifact", exact: true })
    .click();
  await expect(page.getByRole("alert")).toContainText("browser policy blocked");
  await expect(page.locator("iframe")).toHaveCount(0);
  await page
    .getByRole("dialog", { name: "Open interactive artifact" })
    .getByRole("button", { name: "Close", exact: true })
    .click();
  await expect(composer).toHaveValue("Keep this draft and mounted session");
  expect(await sessionNode?.evaluate((node) => node.isConnected)).toBe(true);
  expect(context.pages()).toHaveLength(1);
  expect(
    (await instance.artifactServer.app.request(linkedArtifactUrl)).status,
  ).toBe(200);
});
