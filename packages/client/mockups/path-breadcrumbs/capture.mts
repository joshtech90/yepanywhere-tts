import { expect } from "@playwright/test";
import { captureArtifact } from "../../scripts/artifact-capture";

// list: click a folder segment; menu: right-click a folder segment.
const view = process.argv[2] ?? "list";
if (!["list", "menu"].includes(view)) throw new Error("Expected list or menu");
await captureArtifact({
  input: ".artifacts/mockups/path-breadcrumbs/index.html",
  out: process.argv[3],
  yaUrl: process.env.AGENT_SERVER_URL,
  artifactOrigin: process.env.AGENT_ARTIFACT_VIEWER_ORIGIN,
  ownArtifact: false,
  commentary: true,
  interact: async ({ page }) => {
    if (view === "menu") {
      await page
        .getByRole("button", { name: "asr-meaning-scoring", exact: true })
        .click({ button: "right" });
      await expect(
        page.getByRole("menuitem", { name: "Copy listing" }),
      ).toBeVisible();
      return;
    }
    await page.getByRole("button", { name: "sections", exact: true }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
  },
});
