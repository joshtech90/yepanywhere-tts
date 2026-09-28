import { expect } from "@playwright/test";
import { mkdtemp } from "node:fs/promises";
import { resolve } from "node:path";
import {
  captureArtifact,
  emitCapturePreview,
  writeCapturePreview,
} from "../../scripts/artifact-capture";

const view = process.argv[2] ?? "project";
if (!["project", "session", "menu"].includes(view))
  throw new Error("Expected project, session or menu");
const result = await captureArtifact({
  input: ".artifacts/mockups/project-template-placement/index.html",
  yaUrl: process.env.AGENT_SERVER_URL,
  artifactOrigin: process.env.AGENT_ARTIFACT_VIEWER_ORIGIN,
  ownArtifact: false,
  commentary: true,
  interact: async ({ page, viewport }) => {
    if (view !== "project") {
      await page
        .getByRole("button", { name: "New session", exact: true })
        .click();
      await page
        .getByRole("textbox", { name: "Message", exact: true })
        .pressSequentially("A drawing app with colorful brushes.");
      await page.getByRole("button", { name: "Yep Anywhere" }).click();
      await page
        .getByRole("textbox", { name: "Find or name a project" })
        .pressSequentially("Sketch garden");
      if (view === "menu") {
        await recordWide();
        return;
      }
      await page
        .getByRole("button", { name: "Create “Sketch garden”" })
        .click();
      await expect(
        page.getByRole("textbox", { name: "What are you making?" }),
      ).toHaveValue("A drawing app with colorful brushes.");
      await page
        .getByRole("combobox", { name: "Effort", exact: true })
        .selectOption("High");
      await page
        .getByRole("button", { name: "Use existing", exact: true })
        .click();
      await page
        .getByRole("button", { name: "+ New project", exact: true })
        .click();
      await expect(
        page.getByRole("textbox", { name: "Project name", exact: true }),
      ).toHaveValue("Sketch garden");
      await expect(
        page.getByRole("textbox", { name: "What are you making?" }),
      ).toHaveValue("A drawing app with colorful brushes.");
      await expect(
        page.getByRole("combobox", { name: "Effort", exact: true }),
      ).toHaveValue("High");
    } else {
      await page
        .getByRole("textbox", { name: "Project name", exact: true })
        .pressSequentially("Sketch garden");
    }
    await expect(page.getByRole("radio")).toHaveCount(3);
    await page.getByRole("radio", { name: /Web page/ }).check();
    await expect(
      page.getByRole("textbox", { name: "Project name", exact: true }),
    ).toHaveValue("Sketch garden");
    await page.getByRole("checkbox", { name: "One template" }).check();
    await expect(page.getByRole("radio")).toHaveCount(1);
    await expect(page.getByRole("radio", { name: /App canvas/ })).toBeVisible();
    await page.getByRole("checkbox", { name: "One template" }).uncheck();
    await page.getByRole("button", { name: "Create & prepare" }).click();
    await expect(page.getByRole("status")).toContainText(
      "Preview: create Sketch garden",
    );
    await page.evaluate(() => window.scrollTo(0, 0));
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    await recordWide();

    async function recordWide() {
      if (viewport.name !== "desktop") return;
      const out = await mkdtemp(
        resolve(".artifacts/captures/template-placement-wide-"),
      );
      await page.setViewportSize({ width: 1200, height: 600 });
      await page.evaluate(() => document.fonts.ready);
      const path = resolve(out, `${view}.png`);
      await page.screenshot({ path, animations: "disabled" });
      emitCapturePreview(
        await writeCapturePreview({
          input: `${view} placement`,
          out: resolve(out, "preview"),
          screenshots: [{ name: "desktop", width: 1200, height: 600, path }],
          warnings: [],
        }),
      );
      await page.setViewportSize({
        width: viewport.width,
        height: viewport.height,
      });
    }
  },
});
emitCapturePreview(result);
