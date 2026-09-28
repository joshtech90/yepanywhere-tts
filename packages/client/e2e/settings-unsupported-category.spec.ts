import { expect, test } from "./fixtures.js";
import { recordUiCapture } from "./support/ui-capture";

// Contract: topics/settings-ui-placement.md § Categories.
const VIEWPORTS = [
  { name: "desktop", width: 1000, height: 600 },
  { name: "phone", width: 375, height: 812 },
];

test.describe("Settings category the server does not serve", () => {
  test("answers a typed Emulator URL with its message and asks no device route", async ({
    page,
    baseURL,
  }) => {
    await page.route("**/api/version**", (route) =>
      route.fulfill({ json: { current: "0.8.1", capabilities: [] } }),
    );
    const deviceRequests: string[] = [];
    page.on("request", (request) => {
      if (new URL(request.url()).pathname.startsWith("/api/devices")) {
        deviceRequests.push(request.url());
      }
    });

    const runtimeNotice = page.getByTestId("remote-compatibility-notice");
    for (const [index, viewport] of VIEWPORTS.entries()) {
      await page.setViewportSize(viewport);
      await page.goto(`${baseURL}/settings/emulator`);
      // The stub is an old server that reports no runtime; snooze that
      // unrelated notice once so it cannot cover the pane being checked.
      if (index === 0) {
        await runtimeNotice
          .getByRole("button", { name: "Remind me later" })
          .click();
      }
      await expect(runtimeNotice).toHaveCount(0);
      await expect(
        page.getByText("This server does not support device streaming."),
      ).toBeVisible();
      await expect(
        page.getByRole("button", { name: /^Device Bridge/ }),
      ).toHaveCount(0);
      // Positive control: the list itself rendered.
      if (viewport.name === "desktop") {
        await expect(
          page.getByRole("button", { name: /^Appearance/ }),
        ).toHaveCount(1);
      }
      await recordUiCapture(
        page,
        `settings-emulator-unsupported-${viewport.name}`,
        viewport,
      );
    }
    expect(deviceRequests).toEqual([]);
  });
});
