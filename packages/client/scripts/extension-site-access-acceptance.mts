/** Isolated real-Chromium permission-request boundary; no YA host required. */
import { copyFileSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium, expect } from "@playwright/test";
import { CLICKED_TAB_KEY } from "../src/extension/appTab";
import type { ChromeApi } from "../src/extension/chrome";
import { emitCapturePreview, writeCapturePreview } from "./artifact-capture";

const dist = resolve(
  process.env.YA_EXTENSION_DIST ?? "../browser-extension/dist",
);
const temp = mkdtempSync(join(tmpdir(), "ya-site-access-"));
const screenshots: {
  name: string;
  width: number;
  height: number;
  path: string;
}[] = [];
const errors: string[] = [];
const context = await chromium.launchPersistentContext(join(temp, "chrome"), {
  channel: "chromium",
  headless: true,
  colorScheme: "dark",
  args: [`--disable-extensions-except=${dist}`, `--load-extension=${dist}`],
});
try {
  context.on("weberror", (error) => errors.push(error.error().message));
  const worker =
    context.serviceWorkers()[0] ??
    (await context.waitForEvent("serviceworker"));
  const origin = `chrome-extension://${new URL(worker.url()).host}`;
  // Real ungranted web tab, with no external network or site credentials.
  await context.route("https://github.com/**", (route) =>
    route.fulfill({ contentType: "text/html", body: "<title>GitHub</title>" }),
  );
  const site = await context.newPage();
  await site.goto("https://github.com/");
  const panel = await context.newPage();
  panel.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  await panel.goto(`${origin}/sidepanel.html`);
  // An inactive extension page exercises the same current-tab query as the
  // side panel, without invoking the toolbar or granting activeTab.
  await site.bringToFront();
  await panel.reload();
  const title = panel.getByRole("heading", {
    name: "Find sessions related to this page",
  });
  const disclosure = panel.getByRole("button", {
    name: "Allow scanning this page",
  });
  await expect(disclosure).toHaveAttribute("aria-expanded", "false");
  await expect(title).not.toBeVisible();
  const tab = await panel.evaluate(async () => {
    const chrome = (globalThis as unknown as { chrome: ChromeApi }).chrome;
    return (await chrome.tabs.query({ active: true, currentWindow: true }))[0];
  });
  expect(tab?.url).toBeUndefined();
  expect(tab?.id).toEqual(expect.any(Number));
  const instructions = panel.getByText("Click the Yep Anywhere icon", {
    exact: true,
  });
  await expect(instructions).not.toBeVisible();
  await expect(panel.getByRole("button", { name: /^Allow .+…$/ })).toHaveCount(
    0,
  );
  const permissions = await panel.evaluate(() =>
    (
      globalThis as unknown as { chrome: ChromeApi }
    ).chrome.permissions.getAll(),
  );
  expect(permissions.permissions).not.toContain("tabs");
  expect(permissions.origins ?? []).toEqual([]);

  // Capture both disclosure states; DOM clicks keep the web tab current.
  for (const state of ["collapsed", "expanded"]) {
    if (state === "expanded") {
      await disclosure.evaluate((button: HTMLButtonElement) => button.click());
      await expect(instructions).toBeVisible();
      await expect(
        panel.getByText("Icon hidden?", { exact: false }),
      ).toBeVisible();
    }
    for (const viewport of [
      { name: "desktop", width: 1000, height: 600 },
      { name: "phone", width: 375, height: 812 },
    ]) {
      await panel.setViewportSize(viewport);
      await panel.evaluate(() => document.fonts.ready);
      const name = `${viewport.name}-${state}`;
      const path = join(temp, `${name}.png`);
      // writeCapturePreview archives/presents the owned browser's captures.
      await panel.screenshot({ path, animations: "disabled" });
      screenshots.push({ ...viewport, name, path });
    }
  }

  // Exercise the real storage-event handoff the worker uses after a toolbar
  // click. This supplies its URL, without pretending automation clicked Chrome
  // UI or granted a permission. The existing panel must replace instructions.
  await panel.evaluate(
    async ({ key, tabId }) => {
      const chrome = (globalThis as unknown as { chrome: ChromeApi }).chrome;
      await chrome.storage.session.set({
        [key]: { tabId, url: "https://github.com/" },
      });
    },
    { key: CLICKED_TAB_KEY, tabId: tab?.id },
  );
  await expect(instructions).toHaveCount(0);
  await expect(disclosure).toHaveAttribute("aria-expanded", "true");
  await expect(
    panel.getByRole("button", { name: "Allow github.com…" }),
  ).toBeVisible();

  // Known addresses also invite access on a site's home page.
  await panel.goto(`${origin}/sidepanel.html?url=https://github.com/`);
  await expect(disclosure).toHaveAttribute("aria-expanded", "false");
  await disclosure.click();
  await expect(
    panel.getByRole("button", { name: "Allow github.com…" }),
  ).toBeVisible();
  await panel.goto(
    `${origin}/sidepanel.html?url=https://tomfit.atlassian.net/`,
  );
  await disclosure.click();
  await expect(
    panel.getByRole("button", { name: "Allow tomfit.atlassian.net…" }),
  ).toBeVisible();

  await panel.goto(`${origin}/sidepanel.html?url=chrome://settings/`);
  await expect(disclosure).toHaveCount(0);
  expect(errors).toEqual([]);

  // Preserve PNGs outside the temporary profile before cleanup.
  const out = resolve(
    `../../.artifacts/extension-acceptance/site-access/${Date.now()}`,
  );
  mkdirSync(out, { recursive: true });
  for (const screenshot of screenshots) {
    const path = join(out, `${screenshot.name}.png`);
    copyFileSync(screenshot.path, path);
    screenshot.path = path;
  }
  emitCapturePreview(
    await writeCapturePreview({
      input: "Extension site access invitation",
      out: join(out, "preview"),
      screenshots,
      warnings: [],
    }),
  );
} finally {
  await context.close();
  rmSync(temp, { recursive: true, force: true });
}
