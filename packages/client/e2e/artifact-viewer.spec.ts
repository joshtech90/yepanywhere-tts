import { createRequire } from "node:module";
import { createServer as createHttpServer, request } from "node:http";
import { cp, copyFile, mkdir, mkdtemp, rm } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import { createTestViteServer as createViteServer } from "./support/vite-server";
import { createApp } from "../../server/test/setup/create-app";
import { createFrontendProxy } from "../../server/src/frontend/proxy";
import { MockClaudeSDK } from "../../server/src/sdk/mock";
import { ServerSettingsService } from "../../server/src/services/ServerSettingsService";
import { initFileAccess } from "../../server/src/middleware/file-access";

const clientRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const serverRequire = createRequire(join(clientRoot, "../server/package.json"));
const { getRequestListener } = serverRequire("@hono/node-server");
let vite: Awaited<ReturnType<typeof createViteServer>>;
let instance: ReturnType<typeof createApp>;
let listener: ReturnType<typeof createHttpServer>;
let directory: string;
let base: string;
let entry: string;

test.beforeAll(async () => {
  const scratch = resolve(clientRoot, "../../.artifacts/artifact-browser");
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
  entry = join(bundle, "index.html");
  const settings = new ServerSettingsService({
    dataDir: join(directory, "data"),
  });
  await settings.initialize();
  initFileAccess({
    uploadsDir: directory,
    homeDir: directory,
    tempPaths: [directory],
    envPaths: [directory],
  });
  process.env.VITE_DISABLE_ONBOARDING = "true";
  process.env.VITE_DISABLE_CLI_UPDATE_NOTIFICATIONS = "true";
  vite = await createViteServer({
    root: clientRoot,
    server: { port: 0, host: "127.0.0.1" },
  });
  await vite.listen();
  const viteAddress = vite.httpServer?.address();
  if (!viteAddress || typeof viteAddress === "string")
    throw new Error("Missing Vite port");
  instance = createApp({
    sdk: new MockClaudeSDK(),
    dataDir: join(directory, "data"),
    projectsDir: join(directory, "sessions"),
    serverSettingsService: settings,
    frontendProxy: createFrontendProxy({
      vitePort: viteAddress.port,
      viteHost: "127.0.0.1",
    }),
  });
  listener = createHttpServer(getRequestListener(instance.app.fetch));
  await new Promise<void>((ready) => listener.listen(0, "127.0.0.1", ready));
  const address = listener.address();
  if (!address || typeof address === "string")
    throw new Error("Missing YA port");
  base = `http://localhost:${address.port}`;
  const reservation = createHttpServer();
  await new Promise<void>((ready) => reservation.listen(0, "127.0.0.1", ready));
  const artifactAddress = reservation.address();
  if (!artifactAddress || typeof artifactAddress === "string")
    throw new Error("Missing artifact port");
  await new Promise<void>((resolve, reject) =>
    reservation.close((error) => (error ? reject(error) : resolve())),
  );
  await instance.artifactServer.configure({
    port: artifactAddress.port,
    localOrigin: `http://artifacts.localhost:${address.port}`,
  });
});

test.afterEach(async ({ page }) => {
  // Saving settings refreshes version metadata. Let intercepted responses
  // finish before Playwright closes the browser context.
  await page.unrouteAll({ behavior: "wait" });
});

test.afterAll(async () => {
  if (listener) {
    listener.closeAllConnections();
    await new Promise<void>((resolve, reject) =>
      listener.close((error) => (error ? reject(error) : resolve())),
    );
  }
  if (instance) await instance.disposeSessionReaders();
  if (vite) await vite.close();
  if (directory) await rm(directory, { recursive: true });
});

test("loads the bundle through the same port, preserves scripts, and denies YA access", async ({
  page,
}, testInfo) => {
  const problems: string[] = [];
  page.on("pageerror", (error) => problems.push(error.message));
  await page.setViewportSize({ width: 1000, height: 600 });
  await page.goto(
    `${base}/e2e/fixtures/artifact-viewer.html?path=${encodeURIComponent(entry)}`,
  );
  await page.getByRole("button", { name: "Run interactive preview" }).click();
  const frame = page.frameLocator("iframe");
  await expect(frame.getByRole("status")).toHaveText("3 sample notes");
  await frame.getByRole("button", { name: "Menu", exact: true }).click();
  await expect(
    frame.getByRole("link", { name: "Project details" }),
  ).toBeVisible();
  await frame.getByPlaceholder("Write something").fill("A saved idea");
  await frame.getByRole("button", { name: "Save note" }).click();
  await expect(frame.getByRole("status")).toHaveText("Note saved");
  const child = page.frames().find((frame) => frame.url().includes("/a/"));
  if (!child) throw new Error("Missing artifact frame");
  expect(
    await child.evaluate(async () => {
      await document.fonts.ready;
      return document.fonts.check("17px ArtifactFont");
    }),
  ).toBe(true);
  expect(
    await child.evaluate(() => localStorage.getItem("artifact-note")),
  ).toBe("A saved idea");
  expect(
    await child.evaluate(() => {
      try {
        return parent.document.title;
      } catch {
        return "blocked";
      }
    }),
  ).toBe("blocked");
  expect(
    await child.evaluate(async () => (await fetch("/api/version")).status),
  ).toBe(404);
  const artifacts = resolve(
    clientRoot,
    "../../.artifacts/ui-testing/2026-09-07-artifact-viewer",
  );
  await mkdir(artifacts, { recursive: true });
  await child.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({
    path: join(artifacts, `${testInfo.project.name}-desktop.png`),
  });
  await page.setViewportSize({ width: 375, height: 812 });
  await child.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({
    path: join(artifacts, `${testInfo.project.name}-phone.png`),
  });
  await frame.getByRole("link", { name: "Project details" }).click();
  await expect(
    frame.getByRole("heading", { name: "Project details" }),
  ).toBeVisible();
  expect(problems).toEqual([]);
  const url = child.url();
  await page.getByRole("button", { name: "Stop interactive preview" }).click();
  await expect
    .poll(async () => (await instance.artifactServer.app.request(url)).status)
    .toBe(404);
});

test("saves artifact expiry without revoking links, alongside addresses and port", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 1000, height: 600 });
  await page.goto(`${base}/e2e/fixtures/artifact-viewer.html?settings`);
  await expect(
    page.getByRole("heading", { name: "Interactive HTML artifacts" }),
  ).toBeVisible();
  await expect(
    page.getByLabel("Local artifact address", { exact: true }),
  ).toHaveValue(instance.artifactServer.config.localOrigin!);
  const original = await instance.artifactServer.createGrant(entry, "local");
  const slider = page.getByRole("slider", { name: "Link expiry (days)" });
  await expect(slider).toHaveValue("7");
  await slider.focus();
  await slider.press("Home");
  await slider.press("ArrowRight");
  await expect(slider).toHaveValue("2");
  const numeric = page.getByRole("spinbutton", { name: "Link expiry (days)" });
  await expect(numeric).toHaveValue("2");
  await numeric.fill("12");
  await numeric.press("Tab");
  await expect(slider).toHaveValue("12");
  const saved = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/artifacts/config") &&
      response.request().method() === "PUT",
  );
  await page.getByRole("button", { name: "Save artifact settings" }).click();
  expect((await saved).ok()).toBe(true);
  await expect.poll(() => instance.artifactServer.config.expiryDays).toBe(12);
  const persisted = new ServerSettingsService({
    dataDir: join(directory, "data"),
  });
  await persisted.initialize();
  expect(persisted.getSetting("artifactViewer")?.expiryDays).toBe(12);
  expect(
    (
      await instance.artifactServer.app.request(original.url, {
        method: "HEAD",
      })
    ).status,
  ).toBe(200);
  const start = Date.now();
  const shorter = await instance.artifactServer.createGrant(entry, "local");
  const twelveDays = 12 * 24 * 3600_000;
  expect(shorter.expiresAt).toBeGreaterThanOrEqual(start + twelveDays);
  expect(shorter.expiresAt).toBeLessThanOrEqual(Date.now() + twelveDays);
  const artifacts = resolve(
    clientRoot,
    "../../.artifacts/ui-testing/2026-09-07-artifact-viewer",
  );
  await mkdir(artifacts, { recursive: true });
  await page.screenshot({
    path: join(artifacts, `${testInfo.project.name}-settings-desktop.png`),
  });
  await page.setViewportSize({ width: 375, height: 812 });
  await page.screenshot({
    path: join(artifacts, `${testInfo.project.name}-settings-phone.png`),
  });
  await page
    .getByLabel("Public artifact address (optional)")
    .fill("https://artifacts.example.test");
  await page.getByRole("button", { name: "Save artifact settings" }).click();
  await expect
    .poll(() => instance.artifactServer.config.publicOrigin)
    .toBe("https://artifacts.example.test");
  const health = await new Promise<{ status: number; body: string }>(
    (resolve, reject) => {
      const req = request(
        {
          hostname: "127.0.0.1",
          port: instance.artifactServer.config.port,
          path: "/health",
          headers: { Host: "artifacts.example.test" },
        },
        (response) => {
          let body = "";
          response.setEncoding("utf8");
          response.on("data", (chunk) => {
            body += chunk;
          });
          response.on("end", () =>
            resolve({ status: response.statusCode ?? 0, body }),
          );
        },
      );
      req.on("error", reject);
      req.end();
    },
  );
  expect(health).toEqual({ status: 200, body: '{"artifactViewer":1}' });
  await page.getByLabel("Public artifact address (optional)").fill("");
  await page.getByLabel("Enable local artifact access").uncheck();
  await page.getByRole("button", { name: "Save artifact settings" }).click();
  await expect.poll(() => instance.artifactServer.available).toBe(false);
});

test("omits expiry controls and writes when older metadata lacks the field", async ({
  page,
}) => {
  await instance.artifactServer.configure({
    ...instance.artifactServer.config,
    expiryDays: 2,
  });
  await page.route("**/api/version*", async (route) => {
    const response = await route.fetch();
    const body = await response.json();
    // An older server advertises neither unit, so no expiry control appears.
    delete body.artifactViewer.expiryHours;
    delete body.artifactViewer.expiryDays;
    delete body.artifactViewer.deleteOnExpiry;
    await route.fulfill({ response, json: body });
  });
  await page.goto(`${base}/e2e/fixtures/artifact-viewer.html?settings`);
  await expect(
    page.getByRole("button", { name: "Save artifact settings" }),
  ).toBeVisible();
  await expect(page.getByRole("slider")).toHaveCount(0);
  await expect(
    page.getByRole("spinbutton", { name: "Link expiry (days)" }),
  ).toHaveCount(0);
  const write = page.waitForRequest(
    (request) =>
      request.url().endsWith("/api/artifacts/config") &&
      request.method() === "PUT",
  );
  await page.getByRole("button", { name: "Save artifact settings" }).click();
  expect((await write).postDataJSON()).not.toHaveProperty("expiryDays");
  await expect(page.getByRole("status")).toHaveText("Artifact settings saved");
  expect(instance.artifactServer.config.expiryDays).toBe(2);
});
