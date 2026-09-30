import { expect } from "@playwright/test";
import { mkdtemp } from "node:fs/promises";
import { resolve } from "node:path";
import {
  captureArtifact,
  emitCapturePreview,
  writeCapturePreview,
} from "../../scripts/artifact-capture";

const view = process.argv[2] ?? "shared";
if (!["shared", "user", "example"].includes(view))
  throw new Error("Expected shared, user or example");
const result = await captureArtifact({
  input: ".artifacts/mockups/limited-user-prompts/index.html",
  yaUrl: process.env.AGENT_SERVER_URL,
  artifactOrigin: process.env.AGENT_ARTIFACT_VIEWER_ORIGIN,
  ownArtifact: false,
  commentary: true,
  interact: async ({ page, viewport }) => {
    const shared = page.getByRole("textbox", { name: "Shared block 1" });
    const initial = await shared.inputValue();
    await page.getByRole("checkbox", { name: "Start from default" }).uncheck();
    await expect(
      page.getByText("Replace the provider’s default instructions."),
    ).toBeVisible();
    await expect(shared).toHaveValue(initial);
    await page.getByRole("checkbox", { name: "Start from default" }).check();
    await page.getByRole("button", { name: "+ Add instruction block" }).click();
    const second = page.getByRole("textbox", { name: "Shared block 2" });
    let typed = "";
    for (const character of "Keep responses concise.") {
      await second.pressSequentially(character);
      typed += character;
      await expect(second).toHaveValue(typed, { timeout: 100 });
    }
    await page.getByRole("button", { name: "Move Shared block 2 up" }).click();
    await expect(shared).toHaveValue(typed);
    await page.getByRole("button", { name: "Remove Shared block 1" }).click();
    await expect(shared).toHaveValue(initial);
    if (view !== "shared") {
      await page
        .getByRole("button", { name: "Edit Alex", exact: true })
        .click();
      await expect(page.getByRole("textbox")).toHaveCount(0);
      await expect(page.getByText("No additional instructions.")).toBeVisible();
      if (view === "example") {
        await page
          .getByRole("button", { name: "+ Add instruction block" })
          .click();
        await page
          .getByRole("textbox", { name: "Alex block 1" })
          .pressSequentially(
            "Explain unfamiliar terms and keep examples short.",
          );
        await page
          .getByRole("button", { name: "Preview combined instructions" })
          .click();
        await expect(page.locator("pre")).toHaveText(
          `${initial}\n\nExplain unfamiliar terms and keep examples short.`,
        );
      }
      await page
        .getByRole("button", { name: "Save user", exact: true })
        .click();
    } else {
      await page
        .getByRole("button", { name: "Save shared instructions" })
        .click();
    }
    await expect(page.getByRole("status")).toContainText(
      "No server settings changed.",
    );
    await page.evaluate(() => window.scrollTo(0, 0));
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    const out = await mkdtemp(resolve(".artifacts/captures/limited-prompts-"));
    const width = viewport.name === "desktop" ? 1200 : 375;
    await page.setViewportSize({ width, height: viewport.height });
    await page.evaluate(() => document.fonts.ready);
    const path = resolve(out, `${view}-${viewport.name}.png`);
    await page.screenshot({ path, fullPage: true, animations: "disabled" });
    emitCapturePreview(
      await writeCapturePreview({
        input: `Limited-user instructions · ${view} · full page`,
        out: resolve(out, "preview"),
        screenshots: [
          { name: viewport.name, width, height: viewport.height, path },
        ],
        warnings: [],
      }),
    );
    await page.setViewportSize({
      width: viewport.width,
      height: viewport.height,
    });
  },
});
emitCapturePreview(result);
