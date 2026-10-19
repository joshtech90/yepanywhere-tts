/** Real unpacked-extension build detection and reload, with an owned output/profile. */
import { spawn } from "node:child_process";
import { mkdtemp, readFile, writeFile, rm, utimes } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, expect, type Page, type Worker } from "@playwright/test";
import { writeCapturePreview, emitCapturePreview } from "./artifact-capture";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const temp = await mkdtemp(join(tmpdir(), "ya-extension-dev-accept-"));
const output = join(temp, "extension");
const headed = process.argv.includes("--headed");
const child = spawn(
  process.execPath,
  [join(root, "scripts/dev-extension.mjs")],
  {
    cwd: root,
    env: { ...process.env, YEP_EXTENSION_DEV_DIR: output },
    stdio: ["ignore", "pipe", "pipe"],
  },
);
let logs = "";
for (const stream of [child.stdout, child.stderr])
  stream?.on("data", (chunk: Buffer) => {
    logs = (logs + chunk.toString()).slice(-16_000);
  });
const log = (text: string) => console.error(`[extension-dev] ${text}`);
let context:
  | Awaited<ReturnType<typeof chromium.launchPersistentContext>>
  | undefined;
try {
  const metadata = async () =>
    JSON.parse(await readFile(join(output, "dev-build.json"), "utf8")) as {
      generation: string;
      workerHash: string;
      manifest: string;
    };
  await expect
    .poll(async () => (await metadata().catch(() => null))?.generation, {
      timeout: 60_000,
    })
    .toBeTruthy();
  const original = await metadata();
  context = await chromium.launchPersistentContext(join(temp, "chrome"), {
    channel: "chromium",
    headless: !headed,
    ignoreDefaultArgs: ["--disable-extensions"],
    viewport: { width: 1000, height: 600 },
    args: [
      `--disable-extensions-except=${output}`,
      `--load-extension=${output}`,
    ],
  });
  // Match Load unpacked through Chrome's own control; writing Preferences
  // alone can be reset by Chrome's protected preference checks.
  const extensions = await context.newPage();
  await extensions.goto("chrome://extensions");
  const developerMode = extensions.locator("#devMode");
  if ((await developerMode.getAttribute("aria-pressed")) !== "true")
    await developerMode.click();
  await expect(developerMode).toHaveAttribute("aria-pressed", "true");
  await extensions.close();
  let worker =
    context.serviceWorkers()[0] ??
    (await context.waitForEvent("serviceworker"));
  const origin = worker.url().slice(0, worker.url().lastIndexOf("/"));
  let page = await context.newPage();
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(`${origin}/sidepanel.html?url=https://example.test`);
  const footer = page.locator("footer[data-extension-build]");
  await expect(footer).toHaveAttribute(
    "data-extension-build",
    original.generation,
  );
  await expect(
    page.getByRole("button", { name: "Reload panel", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Reload extension", exact: true }),
  ).toBeVisible();
  const initialTime = await page.evaluate(() => performance.timeOrigin);
  await utimes(
    join(root, "packages/client/src/extension/sidepanel/DevBuildFooter.tsx"),
    new Date(),
    new Date(),
  );
  await expect
    .poll(async () => (await metadata()).generation, { timeout: 60_000 })
    .not.toBe(original.generation);
  const updated = await metadata();
  expect(updated.workerHash).toBe(original.workerHash);
  await expect(
    page.getByRole("button", { name: "Update panel", exact: true }),
  ).toBeVisible({ timeout: 15_000 });
  await page.getByRole("button", { name: "Update panel", exact: true }).click();
  await expect(footer).toHaveAttribute(
    "data-extension-build",
    updated.generation,
  );
  expect(await page.evaluate(() => performance.timeOrigin)).not.toBe(
    initialTime,
  );
  expect(context.serviceWorkers()).toContain(worker);
  await expect(
    page.getByRole("button", { name: "Reload panel", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Reload extension", exact: true }),
  ).toBeVisible();
  const screenshots: Array<{
    name: string;
    width: number;
    height: number;
    path: string;
  }> = [];
  for (const viewport of [
    { width: 1000, height: 600 },
    { width: 375, height: 812 },
  ]) {
    await page.setViewportSize(viewport);
    const path = join(
      root,
      `.artifacts/extension-dev-update-${viewport.width}.png`,
    );
    await page.screenshot({ path });
    screenshots.push({
      name: `development-update-${viewport.width}`,
      ...viewport,
      path,
    });
  }
  log(
    "real source watch detected a new build; UI update kept the page and worker alive",
  );
  if (headed) {
    await rm(join(root, ".artifacts/extension-dev-native-done"), {
      force: true,
    });
    await writeFile(
      join(root, ".artifacts/extension-dev-native-ready.json"),
      JSON.stringify({ origin, output, profile: join(temp, "chrome") }),
    );
    log(
      "native browser ready; create .artifacts/extension-dev-native-done to finish",
    );
    await expect
      .poll(
        async () =>
          readFile(
            join(root, ".artifacts/extension-dev-native-done"),
            "utf8",
          ).catch(() => ""),
        { timeout: 300_000 },
      )
      .toBe("done");
  }
  const fullReload = async (page: Page, worker: Worker) => {
    const url = page.url();
    const closed = worker.waitForEvent("close", { timeout: 15_000 });
    await page
      .getByRole("button", { name: "Reload extension", exact: true })
      .click();
    await closed;
    // The new worker restores pages itself; opening a page here would hide a
    // regression where reload needs a manual wake-up or loses the old URL.
    await expect
      .poll(
        () =>
          context!
            .pages()
            .find((candidate) => candidate !== page && candidate.url() === url),
        { timeout: 15_000 },
      )
      .toBeTruthy();
    const reopened = context!
      .pages()
      .find((candidate) => candidate !== page && candidate.url() === url)!;
    reopened.on("pageerror", (error) => errors.push(error.message));
    await expect(
      reopened.locator("footer[data-extension-build]"),
    ).toBeVisible();
    await expect
      .poll(
        () =>
          context!.serviceWorkers().find((candidate) => candidate !== worker),
        { timeout: 15_000 },
      )
      .toBeTruthy();
    const replacement = context!
      .serviceWorkers()
      .find((candidate) => candidate !== worker)!;
    expect(replacement).not.toBe(worker);
    await expect
      .poll(async () =>
        replacement.evaluate(async () => {
          const chrome = (
            globalThis as unknown as {
              chrome: {
                storage: {
                  local: { get(key: string): Promise<Record<string, unknown>> };
                };
              };
            }
          ).chrome;
          return (
            (await chrome.storage.local.get("ya.dev.reopenPanel"))[
              "ya.dev.reopenPanel"
            ] ?? null
          );
        }),
      )
      .toBeNull();
    return { page: reopened, worker: replacement };
  };

  // Chrome may close a popup or reset its last tab to New Tab during reload.
  const popupUrl = `${origin}/sidepanel.html?url=https://popup.example.test`;
  await page.evaluate(async (url) => {
    const chrome = (
      globalThis as unknown as {
        chrome: {
          windows: { create(options: object): Promise<unknown> };
        };
      }
    ).chrome;
    await chrome.windows.create({
      url,
      type: "popup",
      focused: false,
      width: 480,
      height: 600,
    });
  }, popupUrl);
  await expect
    .poll(() =>
      context!.pages().find((candidate) => candidate.url() === popupUrl),
    )
    .toBeTruthy();
  const originalPopup = context
    .pages()
    .find((candidate) => candidate.url() === popupUrl)!;
  const popupWindow = (target: Page) =>
    target.evaluate(async () =>
      (
        globalThis as unknown as {
          chrome: {
            windows: {
              getCurrent(): Promise<{
                type: string;
                width: number;
                height: number;
              }>;
            };
          };
        }
      ).chrome.windows.getCurrent(),
    );
  const popupBefore = await popupWindow(originalPopup);

  // Force an actual restart with matching worker/manifest and no new build.
  ({ page, worker } = await fullReload(page, worker));
  await expect
    .poll(() =>
      context!.pages().find((candidate) => candidate.url() === popupUrl),
    )
    .toBeTruthy();
  const restoredPopup = context
    .pages()
    .find((candidate) => candidate.url() === popupUrl)!;
  expect(await popupWindow(restoredPopup)).toMatchObject({
    type: "popup",
    width: popupBefore.width,
    height: popupBefore.height,
  });
  expect(
    context.pages().filter((candidate) => candidate.url() === popupUrl),
  ).toHaveLength(1);
  log("manual full reload restarted the worker without a detected update");
  log("the popup's closed window was recreated with its URL and dimensions");

  // A broken metadata endpoint must not remove the manual escape hatch.
  await rm(join(output, "dev-build.json"));
  await expect(page.getByText("Build status unavailable")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Reload extension", exact: true }),
  ).toBeEnabled();
  ({ page, worker } = await fullReload(page, worker));
  log("manual full reload worked with unavailable build metadata");

  // Controlled metadata mismatch exercises the detected full-update action.
  await writeFile(
    join(output, "dev-build.json"),
    JSON.stringify({
      ...updated,
      generation: "worker-update-fixture",
      workerHash: "changed-worker",
    }),
  );
  await expect(page.getByText("New development build available")).toBeVisible({
    timeout: 15_000,
  });
  await expect(
    page.getByRole("button", { name: "Reload panel", exact: true }),
  ).toHaveCount(0, { timeout: 15_000 });
  await fullReload(page, worker);
  log(
    "full runtime reload restarted the worker and consumed the one-shot panel restoration request",
  );
  expect(errors).toEqual([]);
  emitCapturePreview(
    await writeCapturePreview({
      input: "Development extension update controls",
      out: join(root, `.artifacts/extension-dev-preview-${Date.now()}`),
      screenshots,
    }),
  );
  log("PASS");
} catch (error) {
  console.error(logs);
  throw error;
} finally {
  await context?.close();
  child.kill("SIGTERM");
  await new Promise<void>((done) => {
    if (child.exitCode !== null) done();
    else child.once("exit", () => done());
  });
  await rm(temp, { recursive: true, force: true });
}
