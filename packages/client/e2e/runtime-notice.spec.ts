import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { expect, test } from "./fixtures";

test.afterEach(async ({ page }) => {
  // About starts a fresh version check; finish any intercepted requests before
  // Playwright closes the page instead of racing route.fetch during teardown.
  await page.unrouteAll({ behavior: "wait" });
});

// The server is a fresh isolated process from global-setup. Only version
// metadata is varied; navigation/session APIs keep their real implementation.
for (const viewport of [
  { width: 1000, height: 600 },
  { width: 375, height: 812 },
]) {
  test(`old-server runtime advice stays nonblocking at ${viewport.width}px`, async ({
    page,
    baseURL,
  }) => {
    await page.setViewportSize(viewport);
    await page.route("**/api/version*", async (route) => {
      const response = await route.fetch();
      const version = await response.json();
      delete version.serverRuntime;
      await route.fulfill({
        response,
        json: { ...version, latest: null, updateAvailable: false },
      });
    });
    await page.goto(baseURL!);
    await expect(
      page.getByText("mockproject", { exact: true }).first(),
    ).toBeVisible();
    const notice = page.getByTestId("remote-compatibility-notice");
    await expect(notice).toContainText("Check the runtime before updating YA");
    await expect(notice).toContainText("You can keep using this server");
    await expect(page.getByText("Server changed", { exact: true })).toHaveCount(
      0,
    );
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    const output = resolve(
      "../../.artifacts/ui-testing/2026-09-08-node-runtime",
    );
    await mkdir(output, { recursive: true });
    await page.screenshot({
      path: resolve(
        output,
        `${viewport.width === 1000 ? "desktop" : "phone"}.png`,
      ),
    });
    await notice.getByRole("button", { name: "Remind me later" }).click();
    await expect(notice).toHaveCount(0);
    await page.reload();
    await expect(notice).toHaveCount(0);
    await page.goto(`${baseURL}/settings/about`);
    await expect(
      page.getByText("Check the runtime before updating YA", { exact: true }),
    ).toBeVisible();
  });
}
