// Exercises the real desktop renderer with a controlled native IPC boundary.
// Signed installation and native discovery require the separate VM campaign.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { createServer } from "node:net";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
const desktop = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const requireClient = createRequire(join(desktop, "../client/package.json"));
const { chromium } = requireClient("@playwright/test");
const directory = resolve(
  desktop,
  "../../.artifacts/ui-testing/desktop-nightly",
);
mkdirSync(directory, { recursive: true });
const reservation = createServer();
await new Promise((resolve) => reservation.listen(0, "127.0.0.1", resolve));
const port = reservation.address().port;
await new Promise((resolve) => reservation.close(resolve));
const server = spawn(
  process.execPath,
  [
    join(desktop, "node_modules/vite/bin/vite.js"),
    "--host",
    "127.0.0.1",
    "--port",
    String(port),
    "--strictPort",
  ],
  { cwd: desktop, stdio: "pipe" },
);
let serverOutput = "";
server.stdout.on("data", (data) => {
  serverOutput += data;
});
server.stderr.on("data", (data) => {
  serverOutput += data;
});
let browser;
try {
  const url = `http://127.0.0.1:${port}`;
  let ready = false;
  for (let i = 0; i < 100; i++) {
    try {
      ready = (await fetch(url)).ok;
    } catch {}
    if (ready) break;
    if (server.exitCode !== null) throw new Error(serverOutput);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.ok(ready, serverOutput);
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({
    viewport: { width: 1000, height: 600 },
  });
  const errors = [];
  page.on("pageerror", (error) => errors.push(String(error)));
  await page.addInitScript(() => {
    const callbacks = new Map();
    let next = 1;
    window.fixture = {
      track: "stable",
      version: null,
      waiting: false,
      deferred: false,
      installs: 0,
      checks: 0,
      error: null,
    };
    window.__TAURI_INTERNALS__ = {
      transformCallback(callback) {
        const id = next++;
        callbacks.set(id, callback);
        return id;
      },
      unregisterCallback(id) {
        callbacks.delete(id);
      },
      async invoke(command, args) {
        const f = window.fixture;
        if (command === "plugin:event|listen") {
          f.check = () =>
            callbacks.get(args.handler)({ event: args.event, payload: null });
          return next++;
        }
        if (command === "get_server_status") return "running";
        if (command === "get_data_dir") return "Desktop application data";
        if (command === "get_server_output_buffer") return [];
        if (command === "get_update_channel") return f.track;
        if (command === "set_update_channel") {
          if (f.deferSelection)
            await new Promise((_, reject) => {
              f.failSelection = () => reject(new Error("Save failed"));
            });
          f.track = args.track;
          f.version = args.track === "latest" ? "0.3.201" : null;
          f.waiting = args.track === "stable";
          return;
        }
        if (command === "check_update") {
          f.checks++;
          if (f.error) throw new Error(f.error);
          const result = {
            track: f.track,
            version: f.version,
            waitingForStable: f.waiting,
            notes: f.version
              ? "Nightly Latest build.\nSource commit: aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
              : null,
          };
          if (f.deferred)
            await new Promise((resolve) => {
              f.resolve = resolve;
            });
          return result;
        }
        if (command === "install_update") {
          f.installs++;
          await new Promise((resolve) => {
            f.finishInstall = resolve;
          });
        }
        return null;
      },
    };
  });
  await page.goto(url);
  await page.waitForFunction(() => typeof window.fixture.check === "function");
  await page.evaluate(() => window.fixture.check());
  await page
    .getByText("You are running the latest version on this channel.")
    .waitFor();
  await page.locator("select").selectOption("latest");
  await page.getByText("Version 0.3.201 is available.").waitFor();
  assert.equal(await page.evaluate(() => window.fixture.installs), 0);
  await page.screenshot({ path: join(directory, "desktop.png") });
  await page.setViewportSize({ width: 375, height: 812 });
  await page.screenshot({ path: join(directory, "phone.png") });
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
    true,
  );
  await page.locator("select").selectOption("stable");
  await page.getByText(/Waiting for Stable to catch up/).waitFor();
  assert.equal(
    await page.getByRole("button", { name: "Update and restart" }).count(),
    0,
  );
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await page.evaluate(() => {
    window.fixture.deferred = true;
    window.fixture.check();
  });
  await page.getByText("Checking for updates…").waitFor();
  await page.waitForFunction(() => Boolean(window.fixture.resolve));
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await page.evaluate(() => {
    window.fixture.resolve();
    window.fixture.deferred = false;
  });
  await page.waitForTimeout(100);
  assert.equal(await page.getByRole("dialog").count(), 0);
  await page.evaluate(() => window.fixture.check());
  await page.getByText(/Waiting for Stable to catch up/).waitFor();
  await page.evaluate(() => {
    window.fixture.deferSelection = true;
  });
  await page.locator("select").selectOption("latest");
  await page.waitForFunction(() => Boolean(window.fixture.failSelection));
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await page.evaluate(() => {
    window.fixture.failSelection();
    window.fixture.deferSelection = false;
  });
  await page.waitForTimeout(100);
  assert.equal(await page.getByRole("dialog").count(), 0);
  await page.evaluate(() => {
    window.fixture.error = "Latest unavailable";
    window.fixture.check();
  });
  await page.getByText(/Failed to check for updates/).waitFor();
  await page.evaluate(() => {
    window.fixture.error = null;
  });
  await page.locator("select").selectOption("latest");
  await page.getByRole("button", { name: "Update and restart" }).click();
  await page.waitForFunction(() => window.fixture.installs === 1);
  assert.equal(await page.locator("select").isDisabled(), true);
  assert.equal(
    await page.getByRole("button", { name: "Later" }).isVisible(),
    false,
  );
  assert.deepEqual(errors, []);
  console.log(
    `Updater UI passed: channel switch, Stable catch-up, stale dismissal, error recovery, explicit installation. Captures: ${directory}`,
  );
} finally {
  if (browser) await browser.close();
  server.kill();
  await new Promise((resolve) =>
    server.exitCode !== null ? resolve() : server.once("exit", resolve),
  );
}
