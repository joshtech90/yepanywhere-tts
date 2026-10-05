import { expect, test } from "./fixtures";
import { recordUiCapture } from "./support/ui-capture.js";

// The renderer only requests a check. Native discovery/install remain owned by
// the Rust process; this boundary never grants general IPC to a dashboard.
for (const viewport of [
  { width: 1000, height: 600 },
  { width: 375, height: 812 },
]) {
  test(`desktop Settings requests its native updater at ${viewport.width}px`, async ({
    page,
    baseURL,
  }) => {
    await page.setViewportSize(viewport);
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.addInitScript(() => {
      Object.defineProperty(window, "__YEP_DESKTOP_RUNTIME__", {
        value: {
          desktopVersion: "0.2.2",
          bundledYaVersion: "v0.9.1-56-g1002ac1c9",
          nativeUpdateCheck: true,
        },
      });
    });
    let checks = 0;
    let fresh = 0;
    page.on("request", (request) => {
      if (request.url().includes("/api/version?fresh=1")) fresh++;
    });
    await page.route("**/desktop-bootstrap/check-updates", async (route) => {
      expect(route.request().method()).toBe("POST");
      expect(route.request().headers()["x-yep-anywhere"]).toBe("true");
      checks++;
      await route.fulfill({
        status: checks === 1 ? 200 : 503,
        json: { accepted: checks === 1 },
      });
    });
    await page.goto(`${baseURL}/settings/about`);
    await expect(page.getByText("v0.2.2", { exact: false })).toBeVisible();
    await page
      .getByRole("button", { name: "Check for Updates", exact: true })
      .click();
    await expect(
      page
        .getByRole("status")
        .filter({ hasText: "Requested a check in the desktop update window." }),
    ).toBeVisible();
    expect(checks).toBe(1);
    expect(fresh).toBe(0);
    await recordUiCapture(page, `desktop-update-settings-${viewport.width}`);
    await page
      .getByRole("button", { name: "Check for Updates", exact: true })
      .click();
    await expect(
      page
        .getByRole("status")
        .filter({ hasText: "Could not open the desktop updater" }),
    ).toBeVisible();
    expect(checks).toBe(2);
    expect(errors).toEqual([]);
  });
}

test("older desktop Settings gives menu guidance without an unsupported call", async ({
  page,
  baseURL,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, "__YEP_DESKTOP_RUNTIME__", {
      value: { desktopVersion: "0.2.1", bundledYaVersion: "v0.9.0" },
    });
  });
  let checks = 0;
  page.on("request", (request) => {
    if (request.url().includes("/desktop-bootstrap/check-updates")) checks++;
  });
  await page.goto(`${baseURL}/settings/about`);
  await page
    .getByRole("button", { name: "Check for Updates", exact: true })
    .click();
  await expect(
    page
      .getByRole("status")
      .filter({ hasText: "Use Check for Updates in the desktop menu bar" }),
  ).toBeVisible();
  expect(checks).toBe(0);
});

test("ordinary browser Settings keeps checking its standalone server", async ({
  page,
  baseURL,
}) => {
  let fresh = 0;
  page.on("request", (request) => {
    if (request.url().includes("/api/version?fresh=1")) fresh++;
  });
  await page.goto(`${baseURL}/settings/about`);
  await expect(
    page.getByRole("button", { name: "Check for Updates", exact: true }),
  ).toBeVisible();
  const before = fresh;
  await page
    .getByRole("button", { name: "Check for Updates", exact: true })
    .click();
  await expect.poll(() => fresh).toBeGreaterThan(before);
});
