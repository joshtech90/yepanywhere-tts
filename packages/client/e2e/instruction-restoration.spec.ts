import { resolve } from "node:path";
import { expect, test } from "@playwright/test";
import { createTestViteServer } from "./support/vite-server";
import { recordUiCapture, presentUiCaptures } from "./support/ui-capture";

let server: Awaited<ReturnType<typeof createTestViteServer>>;
let base: string;
test.beforeAll(async () => {
  server = await createTestViteServer({
    root: resolve(import.meta.dirname, ".."),
    server: { host: "127.0.0.1", port: 0 },
  });
  await server.listen();
  const address = server.httpServer?.address();
  if (!address || typeof address === "string")
    throw new Error("Missing fixture address");
  base = `http://127.0.0.1:${address.port}`;
});
test.afterAll(async () => {
  try {
    await presentUiCaptures();
  } finally {
    await server?.close();
  }
});
test("keeps every instruction path keystroke during concurrent updates", async ({
  page,
}) => {
  await page.goto(`${base}/e2e/fixtures/instruction-restoration.html`);
  const input = page.getByRole("textbox", { name: "Permitted path prefix" });
  const before = Number(
    await page.locator("main").getAttribute("data-updates"),
  );
  let typed = "";
  for (const character of "~/agents/topics/") {
    await input.pressSequentially(character);
    typed += character;
    await expect(input).toHaveValue(typed, { timeout: 100 });
  }
  expect(
    Number(await page.locator("main").getAttribute("data-updates")),
  ).toBeGreaterThan(before);
  await page.getByLabel("Codex", { exact: true }).check();
  await page
    .getByRole("button", { name: "Save instruction restoration" })
    .click();
  await expect(page.getByRole("status")).toHaveText(
    "Instruction restoration saved.",
  );
  expect(
    JSON.parse((await page.locator("main").getAttribute("data-saved"))!),
  ).toMatchObject({ providers: { codex: true }, pathPrefix: typed });
  for (const viewport of [
    { width: 1200, height: 600 },
    { width: 1000, height: 600 },
    { width: 375, height: 812 },
  ]) {
    await page.setViewportSize(viewport);
    await page.locator("main").scrollIntoViewIfNeeded();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await recordUiCapture(page, `instructions-${viewport.width}`, viewport);
  }
});
