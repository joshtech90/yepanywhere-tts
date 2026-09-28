import { join } from "node:path";
import { e2ePaths, expect, test } from "./fixtures.js";
import { recordUiCapture } from "./support/ui-capture.js";

test.use({ serviceWorkers: "block" });

test("different App snapshots in two tabs settle without storage feedback", async ({
  page,
  context,
  baseURL,
}) => {
  test.setTimeout(60_000);
  const projectId = Buffer.from(join(e2ePaths.tempDir, "mockproject")).toString(
    "base64url",
  );
  const sessionId = "mock-session-001";
  const url = `${baseURL}/projects/${projectId}/sessions/${sessionId}`;
  const other = await context.newPage();
  await context.addInitScript(() => {
    let events = 0;
    window.addEventListener("storage", (event) => {
      if (
        event.key?.startsWith("yep-anywhere-session-apps:") ||
        event.key?.startsWith("yep-anywhere-session-scroll-memory-v1:")
      )
        events++;
    });
    Object.defineProperty(window, "appStorageEvents", { get: () => events });
  });
  await context.route("**/api/version*", async (route) => {
    const response = await route.fetch();
    await route.fulfill({
      json: {
        ...(await response.json()),
        artifactViewer: {
          port: 4402,
          available: true,
          locked: false,
          defaultLocalOrigin: "http://artifacts.localhost:4402",
          localOrigin: "http://artifacts.localhost:4402",
          vhosts: [],
        },
      },
    });
  });
  await context.route(
    new RegExp(
      `/api/projects/[^/]+/sessions/${sessionId}(?:/metadata)?(?:\\?|$)`,
    ),
    (route) => {
      const snapshot =
        route.request().frame().page() === page ? "older" : "newer";
      const timestamp = new Date().toISOString();
      return route.fulfill({
        json: {
          session: {
            id: sessionId,
            projectId,
            provider: "claude",
            title: "App snapshot recovery",
            createdAt: timestamp,
            updatedAt: timestamp,
            ownership: { owner: "none" },
            messageCount: 242,
          },
          ownership: { owner: "none" },
          processState: "idle",
          messages: [
            ...Array.from({ length: 240 }, (_, index) => ({
              uuid: `history-${index}`,
              type: index % 2 ? "assistant" : "user",
              timestamp,
              content: `Review item ${index}: keep typing responsive.`,
            })),
            {
              uuid: `tool-${snapshot}`,
              type: "assistant",
              timestamp,
              content: [
                {
                  type: "tool_use",
                  id: "app",
                  name: "Bash",
                  input: { command: "preview" },
                },
              ],
            },
            {
              uuid: `result-${snapshot}`,
              type: "user",
              timestamp,
              content: [
                {
                  type: "tool_result",
                  tool_use_id: "app",
                  content: `http://artifacts.localhost:4402/a/${snapshot}/review.html`,
                },
              ],
            },
          ],
        },
      });
    },
  );
  await page.setViewportSize({ width: 1200, height: 600 });
  await page.goto(url);
  await expect(
    page.getByRole("link", { name: "App ↗", exact: true }),
  ).toBeVisible();
  await other.goto(url);
  await expect(
    other.getByRole("link", { name: "App ↗", exact: true }),
  ).toBeVisible();
  // Two independently loaded snapshots must reach quiescence, even with the
  // pane disabled and no artifact iframe ever opened.
  const eventCount = () =>
    page.evaluate(
      () =>
        (window as unknown as { appStorageEvents: number }).appStorageEvents,
    );
  await page.waitForTimeout(500);
  const settled = await eventCount();
  console.log("[storage-recovery] settled events", settled);
  expect(settled).toBeLessThan(30);
  await page.bringToFront();
  const input = page.locator("[data-composer-input]").first();
  await input.focus();
  let typed = "";
  for (const char of "Still responsive across tabs.") {
    typed += char;
    await page.keyboard.type(char);
    await expect(input).toHaveValue(typed, { timeout: 100 });
  }
  expect(await eventCount()).toBe(settled);
  await recordUiCapture(page, "app-tabs-desktop");
  await page.setViewportSize({ width: 375, height: 812 });
  await expect(input).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth))
    .toBeLessThanOrEqual(375);
  await recordUiCapture(page, "app-tabs-phone");
  await other.close();
});
