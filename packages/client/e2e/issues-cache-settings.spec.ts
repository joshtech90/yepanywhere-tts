import type { IssueSettings } from "@yep-anywhere/shared";
import { expect, test } from "./fixtures.js";
import { recordUiCapture } from "./support/ui-capture.js";

test("cache lifetime sliders save completed gestures and survive reload", async ({
  page,
  baseURL,
}) => {
  let settings: IssueSettings = {
    enabled: true,
    scope: "viewed",
    recentDays: 7,
    contentTtlSeconds: 1209600,
    statusCommentTtlSeconds: 300,
  };
  let saves = 0;
  await page.route("**/api/issues/settings", async (route) => {
    if (route.request().method() === "PUT") {
      settings = route.request().postDataJSON();
      saves++;
    }
    await route.fulfill({
      json: {
        settings,
        knownJiraProjects: [],
        counts: [],
        active: false,
        error: null,
      },
    });
  });
  await page.goto(`${baseURL}/settings/issues`);
  const content = page.getByRole("slider", {
    name: "Subject & body cache lifetime",
  });
  const status = page.getByRole("slider", {
    name: "Status & comments cache lifetime",
  });
  await expect(content).toHaveAttribute("aria-valuetext", "2 weeks");
  await expect(status).toHaveAttribute("aria-valuetext", "5 minutes");
  await content.focus();
  await page.keyboard.down("Home");
  await expect(content).toHaveAttribute("aria-valuetext", "1 second", {
    timeout: 100,
  });
  expect(saves).toBe(0);
  await page.keyboard.up("Home");
  await expect.poll(() => settings.contentTtlSeconds).toBe(1);
  await expect(status).toBeEnabled();
  await status.press("End");
  await expect.poll(() => settings.statusCommentTtlSeconds).toBeNull();
  await page.reload();
  await expect(content).toHaveAttribute("aria-valuetext", "1 second");
  await expect(status).toHaveAttribute("aria-valuetext", "Never expire (∞)");
  expect(saves).toBe(2);

  settings = {
    ...settings,
    contentTtlSeconds: 1209600,
    statusCommentTtlSeconds: 300,
  };
  await page.reload();
  for (const viewport of [
    { width: 1200, height: 600 },
    { width: 1000, height: 600 },
    { width: 768, height: 1024 },
    { width: 375, height: 812 },
  ]) {
    await page.setViewportSize(viewport);
    // Settings switches shells at phone width; load after choosing the shell.
    await page.reload();
    await expect(content).toBeVisible();
    await page
      .locator('[data-settings-item="issue-contentTtlSeconds"]')
      .evaluate((element) => element.scrollIntoView({ block: "start" }));
    for (const slider of [content, status]) {
      const box = await slider.boundingBox();
      expect(box!.height).toBeGreaterThanOrEqual(44);
      expect(box!.x + box!.width).toBeLessThanOrEqual(viewport.width);
    }
    await recordUiCapture(page, `issues-cache-${viewport.width}`);
  }
});
