import { join } from "node:path";
import { e2ePaths, expect, test } from "./fixtures.js";
import { recordUiCapture } from "./support/ui-capture.js";

test.use({ serviceWorkers: "block" });

test("searchable quality settings control browser resizing before upload", async ({
  page,
  baseURL,
}) => {
  const projectId = Buffer.from(join(e2ePaths.tempDir, "mockproject")).toString(
    "base64url",
  );
  const sessionId = "mock-session-001";
  const timestamp = new Date().toISOString();
  const provider = {
    name: "claude",
    displayName: "Claude",
    installed: true,
    authenticated: true,
    models: [
      {
        id: "image-test",
        name: "Image test",
        imageSizing: {
          defaultLongEdgePx: 1900,
          maxUsefulLongEdgePx: 2300,
          profiles: {
            sd: { maxLongEdge: 1900, maxBytes: 3 * 1024 * 1024, quality: 90 },
            hd: { maxLongEdge: 2300, maxBytes: 3 * 1024 * 1024, quality: 95 },
          },
        },
      },
    ],
  };
  await page.route(/\/api\/providers(?:\/claude)?(?:\?|$)/, (route) =>
    route.fulfill({ json: { providers: [provider], provider } }),
  );
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
            model: "image-test",
            title: "Image quality",
            createdAt: timestamp,
            updatedAt: timestamp,
            messageCount: 1,
          },
          ownership: { owner: "none" },
          messages: [
            {
              uuid: "first",
              type: "user",
              timestamp,
              content: "Inspect screenshots",
            },
          ],
        },
      }),
  );
  const pngWidths: number[] = [];
  page.on("websocket", (socket) => {
    if (!socket.url().includes("/upload/ws")) return;
    socket.on("framesent", ({ payload }) => {
      if (
        Buffer.isBuffer(payload) &&
        payload.length >= 24 &&
        payload.subarray(1, 4).toString() === "PNG"
      ) {
        pngWidths.push(payload.readUInt32BE(16));
      }
    });
  });
  await page.setViewportSize({ width: 1000, height: 600 });
  await page.goto(`${baseURL}/settings`);
  const search = page.getByRole("searchbox", { name: "Search settings" });
  for (const character of "SD") {
    await search.pressSequentially(character);
    await expect(search).toHaveValue(character === "S" ? "S" : "SD", {
      timeout: 100,
    });
  }
  const quality = page.getByRole("combobox", { name: "Image upload quality" });
  await expect(quality).toHaveValue("sd");
  await quality.selectOption("hd");
  await recordUiCapture(page, "image-quality-desktop");
  await page.setViewportSize({ width: 375, height: 812 });
  await recordUiCapture(page, "image-quality-phone");

  const image = await page.evaluate(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 4000;
    canvas.height = 2000;
    const context = canvas.getContext("2d")!;
    context.fillStyle = "#123456";
    context.fillRect(0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/png").split(",")[1]!;
  });
  await page.goto(`${baseURL}/projects/${projectId}/sessions/${sessionId}`);
  await page
    .locator('input[type="file"]')
    .first()
    .setInputFiles({
      name: "hd.png",
      mimeType: "image/png",
      buffer: Buffer.from(image, "base64"),
    });
  await expect.poll(() => pngWidths).toEqual([2300]);
  await expect(
    page.getByRole("button", { name: "Remove hd-resized.png", exact: true }),
  ).toBeVisible();

  const settings = await page.context().newPage();
  await settings.goto(`${baseURL}/settings`);
  await settings.getByRole("searchbox", { name: "Search settings" }).fill("HD");
  await settings
    .getByRole("combobox", { name: "Image upload quality" })
    .selectOption("sd");
  await page.bringToFront();
  await page
    .locator('input[type="file"]')
    .first()
    .setInputFiles({
      name: "sd.png",
      mimeType: "image/png",
      buffer: Buffer.from(image, "base64"),
    });
  await expect.poll(() => pngWidths).toEqual([2300, 1900]);
  await expect(
    page.getByRole("button", { name: "Remove sd-resized.png", exact: true }),
  ).toBeVisible();
});
