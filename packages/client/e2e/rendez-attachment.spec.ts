import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { e2ePaths, expect, test } from "./fixtures.js";
import { recordUiCapture } from "./support/ui-capture.js";

test.use({ serviceWorkers: "block" });

test("rendez history renders a thumbnail and opens its original", async ({
  page,
  baseURL,
}) => {
  const project = join(e2ePaths.tempDir, "mockproject");
  const projectId = Buffer.from(project).toString("base64url");
  const sessionId = "mock-session-001";
  const directory = join(project, ".rendez/delivered/screenshots/upload-1");
  await mkdir(directory, { recursive: true });
  const prepared = await readFile(
    new URL("../public/icon-192.png", import.meta.url),
  );
  const original = await readFile(
    new URL("../public/icon-512.png", import.meta.url),
  );
  const snapshotPath = join(directory, "file.png");
  const originalPath = join(project, ".rendez/screenshot.png");
  await writeFile(snapshotPath, prepared);
  await writeFile(originalPath, original);
  await writeFile(
    join(directory, "record.json"),
    JSON.stringify({
      path: snapshotPath,
      originalPath,
      sha256: createHash("sha256").update(original).digest("hex"),
    }),
  );
  const timestamp = new Date().toISOString();
  await page.route(
    new RegExp(
      `/api/projects/[^/]+/sessions/${sessionId}(?:/metadata)?(?:\\?|$)`,
    ),
    (route) =>
      route.fulfill({
        json: {
          session: {
            id: sessionId,
            projectId,
            provider: "claude",
            title: "Rendez upload",
            createdAt: timestamp,
            updatedAt: timestamp,
            messageCount: 1,
          },
          ownership: { owner: "none" },
          messages: [
            {
              uuid: "rendez-upload",
              type: "user",
              timestamp,
              content: `Please inspect the uploaded file.\n\nUser uploaded files:\n- [screenshot.png](<${snapshotPath}>) (${prepared.length} B, image/png, 192x192)`,
            },
          ],
        },
      }),
  );
  await page.setViewportSize({ width: 1000, height: 600 });
  await page.goto(`${baseURL}/projects/${projectId}/sessions/${sessionId}`);
  const chip = page.getByRole("button", {
    name: "Open screenshot.png",
    exact: true,
  });
  await expect(chip).toHaveCount(1);
  await expect(chip.locator("img")).toBeVisible();
  await expect
    .poll(() =>
      chip
        .locator("img")
        .evaluate((image: HTMLImageElement) => image.naturalWidth),
    )
    .toBeGreaterThan(0);
  await recordUiCapture(page, "rendez-desktop");
  await page.setViewportSize({ width: 375, height: 812 });
  await recordUiCapture(page, "rendez-phone");
  await chip.click();
  const fullImage = page.getByRole("img", {
    name: "screenshot.png",
    exact: true,
  });
  await expect
    .poll(() =>
      fullImage.evaluate((image: HTMLImageElement) => image.naturalWidth),
    )
    .toBe(512);
  await page.reload();
  await expect(chip).toHaveCount(1);
  await expect(chip.locator("img")).toBeVisible();
});
