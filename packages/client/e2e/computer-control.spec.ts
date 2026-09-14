import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import { createTestViteServer } from "./support/vite-server";
import {
  startYaServerProcess,
  stopYaServerProcess,
  terminateYaServerProcess,
} from "./support/ya-server-process";
import { recordUiCapture } from "./support/ui-capture";

test("Computer Control operator actions and old-server fallback", async ({
  page,
}) => {
  test.setTimeout(180_000);
  const clientPath = dirname(dirname(fileURLToPath(import.meta.url)));
  const backend = await startYaServerProcess({
    label: "computer control",
    env:
      process.platform === "win32"
        ? {
            PSModulePath: join(
              process.env.SystemRoot ?? "C:\\Windows",
              "System32/WindowsPowerShell/v1.0/Modules",
            ),
          }
        : {},
  });
  const source = await createTestViteServer({
    configFile: join(clientPath, "vite.config.ts"),
    define: { __VITE_DEV_PORT__: "-1" },
    server: {
      port: 0,
      strictPort: false,
      host: "127.0.0.1",
      proxy: { "/api": { target: backend.baseUrl, ws: true } },
    },
  });
  let status = {
    enabled: false,
    available: true,
    running: false,
    busy: false,
    idleMs: 60000,
    grantMs: 1800000,
    preview: {
      packageDirectory: "C:\\signed-preview",
      trustedPublisher: "Trusted preview publisher",
    } as { packageDirectory: string; trustedPublisher: string } | undefined,
    release: {
      installedVersion: "0.1.0" as string | undefined,
      latestVersion: "0.2.0",
      updateAvailable: true,
      autoUpdate: true,
      working: false,
    },
    sessions: [
      { sessionId: "selected-session", expiresAt: Date.now() + 60000 },
    ],
  };
  const requests: Array<{ method: string; path: string }> = [];
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/api/computer-control**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    requests.push({ method: request.method(), path });
    if (path.endsWith("/settings"))
      status = { ...status, ...request.postDataJSON() };
    if (path.endsWith("/enabled"))
      status = {
        ...status,
        enabled: request.postDataJSON().enabled,
        sessions: [],
        preview: {
          packageDirectory: "C:\\signed-preview",
          trustedPublisher: "Trusted preview publisher",
        },
        release: {
          ...status.release,
          installedVersion: "0.1.0",
          updateAvailable: true,
        },
      };
    if (path.endsWith("/update"))
      status = {
        ...status,
        release: {
          ...status.release,
          installedVersion: "0.2.0",
          updateAvailable: false,
        },
      };
    if (path.endsWith("/automatic"))
      status = {
        ...status,
        release: { ...status.release, ...request.postDataJSON() },
      };
    if (path.endsWith("/stop"))
      status = { ...status, enabled: false, sessions: [] };
    if (path.includes("/sessions/")) status = { ...status, sessions: [] };
    await route.fulfill({ json: status });
  });
  try {
    await source.listen();
    const address = source.httpServer?.address();
    if (!address || typeof address === "string")
      throw new Error("Missing Vite port");
    const origin = `http://127.0.0.1:${address.port}`;
    for (const viewport of [
      { name: "desktop", width: 1000, height: 600 },
      { name: "phone", width: 375, height: 812 },
    ]) {
      status = {
        ...status,
        enabled: false,
        preview: undefined,
        sessions: [],
        release: {
          ...status.release,
          installedVersion: undefined,
          updateAvailable: false,
        },
      };
      await page.setViewportSize(viewport);
      await page.goto(`${origin}/settings/computer-control`);
      const enable = page.getByRole("switch", {
        name: "Enable Computer Control",
        exact: true,
      });
      await expect(enable).toBeVisible({ timeout: 30000 });
      await expect(
        page.getByText(/Not installed. Enable to download/),
      ).toBeVisible();
      await recordUiCapture(page, `computer-control-install-${viewport.name}`, {
        width: viewport.width,
        height: viewport.height,
      });
      await enable.click();
      await expect(enable).toBeChecked();
      await expect(
        page.getByLabel("Preview package directory on the server"),
      ).not.toBeVisible();
      await page.getByRole("button", { name: "Check for updates" }).click();
      await expect(
        page.getByRole("button", { name: "Uninstall", exact: true }),
      ).toBeEnabled();
      await recordUiCapture(page, `computer-control-${viewport.name}`, {
        width: viewport.width,
        height: viewport.height,
      });
      await page.getByRole("button", { name: "Check for updates" }).click();
      await page
        .getByRole("button", { name: "Uninstall", exact: true })
        .scrollIntoViewIfNeeded();
      await recordUiCapture(
        page,
        `computer-control-lifecycle-${viewport.name}`,
        { width: viewport.width, height: viewport.height },
      );
      await page
        .getByRole("button", { name: "Update now", exact: true })
        .click();
      await expect(page.getByText(/Installed: 0.2.0/)).toBeVisible();
      await enable.click();
      await expect(enable).not.toBeChecked();
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth,
        ),
      ).toBe(true);
    }
    expect(
      requests.some(
        (r) => r.method === "PUT" && r.path.endsWith("/releases/enabled"),
      ),
    ).toBe(true);
    await page.route("**/api/version**", (route) =>
      route.fulfill({ json: { current: "0.8.1", capabilities: [] } }),
    );
    requests.length = 0;
    await page.goto(`${origin}/settings/computer-control`);
    await expect(
      page.getByText("This server does not support Computer Control."),
    ).toBeVisible({ timeout: 30000 });
    expect(requests).toHaveLength(0);
    await page.route("**/api/version**", (route) =>
      route.fulfill({
        json: {
          current: "0.8.1",
          capabilityEncoding: 1,
          capabilityBits: [[2, 64]],
        },
      }),
    );
    requests.length = 0;
    await page.goto(`${origin}/settings/computer-control`);
    await expect(
      page.getByText(/Update this YA server to enable automatic/),
    ).toBeVisible({ timeout: 30000 });
    expect(requests.every((r) => !r.path.includes("/releases/"))).toBe(true);
    expect(errors).toEqual([]);
  } finally {
    await page.close();
    await source.close();
    await terminateYaServerProcess(backend);
    await stopYaServerProcess(backend);
  }
});
