import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "./fixtures.js";

test.use({ serviceWorkers: "block" });

for (const width of [375, 1000, 1100, 1200, 1400]) {
  test(`provider limits keep readable text at ${width}px`, async ({
    page,
    baseURL,
  }) => {
    await page.setViewportSize({
      width,
      height: width === 375 ? 812 : 600,
    });
    await page.goto(`${baseURL}/settings/providers`);
    const firstRow = page.locator(
      '[data-settings-item="providers-subagent-max-depth"]',
    );
    await expect(firstRow).toBeVisible();

    for (const fontSize of [16, 20]) {
      await page.evaluate((size) => {
        document.documentElement.style.fontSize = `${size}px`;
      }, fontSize);
      for (const id of [
        "providers-subagent-max-depth",
        "providers-idle-reap-hours",
      ]) {
        const row = page.locator(`[data-settings-item="${id}"]`);
        await expect
          .poll(() =>
            row.evaluate((element) => {
              const info = element.querySelector(".settings-item-info");
              if (!info) throw new Error("Missing setting explanation");
              return (
                info.getBoundingClientRect().width /
                element.getBoundingClientRect().width
              );
            }),
          )
          .toBeGreaterThan(0.4);
        expect(
          await row.evaluate(
            (element) => element.scrollWidth <= element.clientWidth + 1,
          ),
        ).toBe(true);
      }
    }

    await page.evaluate(() => {
      document.documentElement.style.fontSize = "";
    });
    await firstRow.scrollIntoViewIfNeeded();
    await expect(
      page.getByText("Server changed", { exact: false }),
    ).toHaveCount(0);
    const directory = process.env.YEP_E2E_UI_CAPTURE_DIR;
    if (directory) {
      mkdirSync(directory, { recursive: true });
      await page.screenshot({
        animations: "disabled",
        path: join(directory, `providers-${width}.png`),
      });
    }
  });
}
