import { expect, test } from "@playwright/test";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createTestViteServer } from "./support/vite-server";
import { recordUiCapture, presentUiCaptures } from "./support/ui-capture";
let server: Awaited<ReturnType<typeof createTestViteServer>>;
let base: string;
test.beforeAll(async () => {
  server = await createTestViteServer({
    root: resolve(dirname(fileURLToPath(import.meta.url)), ".."),
    server: { host: "127.0.0.1" },
  });
  await server.listen();
  base = server.resolvedUrls!.local[0]!;
});
test.afterAll(async () => {
  await server?.close();
  await presentUiCaptures();
});
for (const mobile of [false, true]) {
  test(`prompt rail insertion, cancellation and typing ${mobile ? "touch" : "mouse"}`, async ({
    browser,
  }) => {
    const context = await browser.newContext({
      viewport: { width: mobile ? 375 : 1200, height: mobile ? 812 : 600 },
      isMobile: mobile,
      hasTouch: mobile,
    });
    const page = await context.newPage();
    try {
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.goto(`${base}e2e/fixtures/prompt-history.html`);
      const target = page.getByRole("button", { name: /^Recent prompt 1\./ });
      await expect(
        page.getByRole("group", { name: "Recent prompts" }).getByRole("button"),
      ).toHaveCount(50);
      const bounds = (await target.boundingBox())!;
      expect(bounds.width).toBeGreaterThanOrEqual(mobile ? 44 : 36);
      expect(bounds.height).toBeGreaterThanOrEqual(mobile ? 44 : 36);
      // Begin near the corner, well outside the 14x2 painted dash.
      const from = { x: bounds.x + 3, y: bounds.y + 3 };
      const input = page.getByRole("textbox", { name: "Prompt" });
      const box = (await input.boundingBox())!;
      const to = { x: box.x + 14, y: box.y + 48 };
      const touch = mobile ? await context.newCDPSession(page) : null;
      if (touch)
        await touch.send("Input.dispatchTouchEvent", {
          type: "touchStart",
          touchPoints: [from],
        });
      else {
        await page.mouse.move(from.x, from.y);
        await page.mouse.down();
      }
      await expect(page.getByRole("tooltip")).toHaveText(
        "Let the rider turn around.",
      );
      await recordUiCapture(
        page,
        `rail-${mobile ? "phone" : "desktop"}-preview`,
      );
      if (touch)
        await touch.send("Input.dispatchTouchEvent", {
          type: "touchMove",
          touchPoints: [to],
        });
      else await page.mouse.move(to.x, to.y, { steps: 8 });
      await expect(page.getByRole("tooltip")).toHaveCSS(
        "transform",
        "matrix(0.5, 0, 0, 0.5, 0, 0)",
      );
      const caret = page.locator("[data-prompt-drop-caret]");
      await expect(caret).toBeVisible();
      const position = (await caret.boundingBox())!;
      expect(position.y).toBeGreaterThan(box.y);
      expect(position.y).toBeLessThan(box.y + box.height);
      await recordUiCapture(page, `rail-${mobile ? "phone" : "desktop"}-drag`);
      if (touch)
        await touch.send("Input.dispatchTouchEvent", {
          type: "touchEnd",
          touchPoints: [],
        });
      else await page.mouse.up();
      await expect(input).toHaveValue(
        "Before\nLet the rider turn around.\nAfter",
      );
      await expect(caret).toHaveCount(0);
      await expect(page.getByRole("tooltip")).toHaveCount(0);
      // Outside release cancels; keyboard activation uses the saved caret.
      await page.mouse.move(from.x, from.y);
      await page.mouse.down();
      await page.mouse.move(box.x + box.width + 20, box.y + box.height + 50);
      await page.mouse.up();
      await expect(input).toHaveValue(
        "Before\nLet the rider turn around.\nAfter",
      );
      await input.evaluate((node: HTMLTextAreaElement) =>
        node.setSelectionRange(0, 0),
      );
      await target.focus();
      await target.press("Enter");
      await expect(input).toHaveValue(
        "Let the rider turn around.Before\nLet the rider turn around.\nAfter",
      );
      let value = await input.inputValue();
      await input.press("ControlOrMeta+End");
      for (const char of " Typing remains immediate.") {
        value += char;
        await input.pressSequentially(char);
        await expect(input).toHaveValue(value, { timeout: 100 });
      }
      await page.mouse.move(from.x, from.y);
      await page.mouse.down();
      await page.mouse.move(to.x, to.y);
      await page.keyboard.press("Escape");
      await page.mouse.up();
      await expect(input).toHaveValue(value);
      await expect(page.getByRole("tooltip")).toHaveCount(0);
      const lines = Array.from({ length: 40 }, (_, index) => `Line ${index}`);
      await input.fill(lines.join("\n"));
      await input.evaluate((node: HTMLTextAreaElement) => {
        node.scrollTop = 240;
      });
      await page.mouse.move(from.x, from.y);
      await page.mouse.down();
      await page.mouse.move(box.x + 14, box.y + 24);
      await page.mouse.up();
      lines[10] = `Let the rider turn around.${lines[10]}`;
      await expect(input).toHaveValue(lines.join("\n"));
      await input.evaluate((node: HTMLTextAreaElement) => {
        node.readOnly = true;
      });
      await target.focus();
      await target.press("Enter");
      await expect(input).toHaveValue(lines.join("\n"));
      await page.getByRole("button", { name: "Switch account" }).click();
      await expect(
        page.getByRole("group", { name: "Recent prompts" }).getByRole("button"),
      ).toHaveCount(0);
      expect(errors).toEqual([]);
    } finally {
      await context.close();
    }
  });
}
