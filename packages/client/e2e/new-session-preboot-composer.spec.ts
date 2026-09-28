import type { Page, Route } from "@playwright/test";
import { expect, test } from "./fixtures.js";

// A tab opened on /new-session is typeable from the HTML alone; the app's
// composer takes the text over when it mounts. See
// topics/early-typing-handoff.md § Pre-boot composer.
test.use({ serviceWorkers: "block" });

/** Hold every script request until released, so only inline code runs. */
async function holdScripts(page: Page): Promise<() => Promise<void>> {
  const held: Route[] = [];
  let releasing = false;
  await page.route("**/*", (route) => {
    if (releasing || route.request().resourceType() !== "script") {
      return route.continue();
    }
    held.push(route);
  });
  return async () => {
    releasing = true;
    await Promise.all(held.splice(0).map((route) => route.continue()));
  };
}

test("keys typed before the app loads reach the new-session composer", async ({
  page,
  baseURL,
}) => {
  // Wide enough for the desktop sidebar, which this tab starts minimized.
  await page.setViewportSize({ width: 1400, height: 700 });
  const release = await holdScripts(page);
  // DOMContentLoaded waits for the held module scripts, so only commit.
  await page.goto(`${baseURL}/new-session`, { waitUntil: "commit" });

  const preboot = page.locator("#yep-preboot-composer textarea");
  await expect(preboot).toBeFocused();
  await page.keyboard.type("typed before boot", { delay: 10 });
  // Enter sends in the app; it must not become a newline in the meantime.
  await page.keyboard.press("Enter");
  await expect(preboot).toHaveValue("typed before boot");

  await release();

  const composer = page.locator("textarea.new-session-form-textarea");
  await expect(composer).toBeFocused({ timeout: 30_000 });
  await expect(page.locator("#yep-preboot-composer")).toHaveCount(0);
  await page.keyboard.type(" and after", { delay: 10 });
  await expect(composer).toHaveValue("typed before boot and after");

  await expect(page.locator(".sidebar-floating-restore")).toBeVisible();
  await expect(page.locator(".sidebar-desktop")).toHaveCount(0);
});

test("other routes never show the pre-boot composer", async ({
  page,
  baseURL,
}) => {
  await page.goto(`${baseURL}/projects`, { waitUntil: "domcontentloaded" });
  await expect(page.locator("#yep-preboot-composer")).toHaveCount(0);
});
