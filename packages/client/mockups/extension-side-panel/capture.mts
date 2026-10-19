import { expect } from "@playwright/test";
import { mkdtemp } from "node:fs/promises";
import { resolve } from "node:path";
import {
  captureArtifact,
  emitCapturePreview,
  writeCapturePreview,
} from "../../scripts/artifact-capture";

const LABELS = {
  pr: "Panel · on a PR",
  off: "Panel · site not enabled",
  elsewhere: "Panel · other page",
  options: "Options",
} as const;
const view = (process.argv[2] ?? "pr") as keyof typeof LABELS;
if (!(view in LABELS))
  throw new Error(`Expected one of ${Object.keys(LABELS).join(", ")}`);

const result = await captureArtifact({
  input: ".artifacts/mockups/extension-side-panel/index.html",
  yaUrl: process.env.AGENT_SERVER_URL,
  artifactOrigin: process.env.AGENT_ARTIFACT_VIEWER_ORIGIN,
  ownArtifact: false,
  commentary: true,
  interact: async ({ page, viewport }) => {
    const status = page.getByRole("status").last();
    await page
      .getByRole("navigation", { name: "Mockup views" })
      .getByRole("button", { name: LABELS[view] })
      .click();
    if (view === "pr") {
      await page
        .getByRole("button", { name: "Open Review PR #482 feedback" })
        .click();
      await expect(status).toContainText("in the existing YA tab");
    }
    if (view === "off") {
      await page
        .getByRole("button", {
          name: "Look up github.com pages automatically…",
        })
        .click();
      await expect(
        page.getByText("No permission was requested in this mockup."),
      ).toBeVisible();
    }
    if (view === "elsewhere") {
      await expect(
        page.getByRole("region", { name: "Needs you" }),
      ).toBeVisible();
    }
    if (view === "options") {
      const list = page.getByRole("textbox", {
        name: "Repositories and Jira projects to look up",
      });
      await list.focus();
      await list.evaluate((element: HTMLTextAreaElement) =>
        element.setSelectionRange(element.value.length, element.value.length),
      );
      let typed = await list.inputValue();
      for (const character of "\nPLAT") {
        await list.press(character === "\n" ? "Enter" : character);
        typed += character;
        await expect(list).toHaveValue(typed, { timeout: 100 });
      }
      await page
        .getByRole("listitem")
        .filter({ hasText: "home-linux" })
        .getByText("Active")
        .click();
      await expect(
        page.getByRole("checkbox", { name: "Use home-linux" }),
      ).toBeChecked();
      await expect(status).toContainText("home-linux activated");
      await page.evaluate(() => {
        window.scrollTo(0, 0);
        document.querySelector("main")?.parentElement?.scrollTo(0, 0);
      });
    }
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);

    // A taller still alongside the standard viewport capture.
    const out = await mkdtemp(resolve(".artifacts/captures/extension-panel-"));
    const height = viewport.name === "desktop" ? 900 : viewport.height;
    await page.setViewportSize({ width: viewport.width, height });
    await page.evaluate(() => document.fonts.ready);
    const path = resolve(out, `${view}-${viewport.name}.png`);
    await page.screenshot({
      path,
      fullPage: viewport.name !== "desktop",
      animations: "disabled",
    });
    emitCapturePreview(
      await writeCapturePreview({
        input: `Extension ${LABELS[view]} · ${viewport.name} · tall`,
        out: resolve(out, "preview"),
        screenshots: [
          { name: viewport.name, width: viewport.width, height, path },
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
