import { join } from "node:path";
import type { Page } from "@playwright/test";
import { e2ePaths, expect, test } from "./fixtures.js";
import { recordUiCapture } from "./support/ui-capture.js";
import { routeWithDrain } from "./support/managed-routes.js";

const mockProjectPath = join(e2ePaths.tempDir, "mockproject");
const projectId = Buffer.from(mockProjectPath).toString("base64url");
const sessionId = "mock-session-001";

test.use({ serviceWorkers: "block" });

async function dismissOnboardingIfVisible(page: Page) {
  const dialog = page.getByText("Welcome to yepanywhere");
  const appeared = await dialog
    .waitFor({ state: "visible", timeout: 2_000 })
    .then(() => true)
    .catch(() => false);
  if (!appeared) return;
  await page.getByRole("button", { name: "Skip all" }).click({ force: true });
  await expect(dialog).not.toBeVisible();
}

for (const viewport of [
  { name: "desktop", width: 1000, height: 600, touch: false },
  { name: "phone", width: 375, height: 812, touch: true },
] as const) {
  // Wide-screen attachments now own the shared panel context action. Exercise
  // generic desktop quick-hide on Commands, and the attachment menu on touch.
  const controlKey = viewport.touch ? "attachments" : "slashMenu";
  test(`hides a toolbar control from its ${viewport.name} hint`, async ({
    page,
    baseURL,
  }) => {
    // Hiding a control also saves a server default. Keep this case's defaults
    // and write acknowledgement private so desktop cannot hide it for phone
    // or for the next file assigned to this worker.
    let presence: "first" | "hidden" = "first";
    await routeWithDrain(page, "**/api/version*", async (route) => {
      const response = await route.fetch();
      const body = await response.json();
      await route.fulfill({
        response,
        json: {
          ...body,
          clientDefaults: {
            ...body.clientDefaults,
            sessionToolbarPresence: {
              ...body.clientDefaults?.sessionToolbarPresence,
              [controlKey]: presence,
            },
          },
        },
      });
    });
    await page.route("**/api/settings", async (route) => {
      if (route.request().method() !== "PUT") return route.fallback();
      const payload = route.request().postDataJSON();
      expect(payload.clientDefaults.sessionToolbarPresence[controlKey]).toBe(
        "hidden",
      );
      presence = "hidden";
      await route.fulfill({ json: { settings: payload } });
    });
    await page.setViewportSize(viewport);
    await page.goto(`${baseURL}/projects/${projectId}/sessions/${sessionId}`);
    await dismissOnboardingIfVisible(page);

    const control = page
      .locator(`[data-session-toolbar-control="${controlKey}"]`)
      .filter({ visible: true })
      .first();
    await expect(control).toBeVisible({ timeout: 10_000 });
    if (viewport.touch) {
      const box = await control.boundingBox();
      if (!box) throw new Error("Attachment control has no visible bounds");
      // Exercise the real long-press handler. Playwright dispatchEvent treats
      // contextmenu as a generic Event, which has no client coordinates.
      await control.dispatchEvent("pointerdown", {
        pointerType: "touch",
        isPrimary: true,
        button: 0,
        clientX: box.x + box.width / 2,
        clientY: box.y + box.height / 2,
      });
      await expect(
        page.getByRole("menu", { name: "Share to session" }),
      ).toBeVisible();
      await control.dispatchEvent("pointerup", { pointerType: "touch" });
    } else {
      await control.click({ button: "right" });
    }

    const quickHide = viewport.touch
      ? page.getByRole("menu", { name: "Share to session" })
      : page.getByRole("dialog", { name: "Toolbar control actions" });
    const hide = quickHide.getByRole(viewport.touch ? "menuitem" : "button", {
      name: "Hide",
      exact: true,
    });
    await expect(quickHide).toBeVisible();
    if (viewport.touch) {
      await expect(
        quickHide.getByRole("menuitem", { name: "Attach files", exact: true }),
      ).toBeVisible();
    } else {
      await expect(quickHide).toContainText("Commands and skills");
    }
    await expect(hide).toBeVisible();
    await expect(quickHide).toBeInViewport();
    await expect(
      page.getByText("Server changed", { exact: false }),
    ).toHaveCount(0);

    await recordUiCapture(page, `toolbar-hide-${viewport.name}`);

    await hide.click();
    await expect(
      page.locator(`[data-session-toolbar-control="${controlKey}"]`),
    ).toBeHidden();
    await expect.poll(() => presence).toBe("hidden");
  });
}
