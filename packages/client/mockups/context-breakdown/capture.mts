import { expect } from "@playwright/test";
import {
  captureArtifact,
  emitCapturePreview,
} from "../../scripts/artifact-capture";

const view = process.argv[2] ?? "collapsed";
if (!["collapsed", "expanded", "unavailable"].includes(view))
  throw new Error("Expected collapsed, expanded or unavailable");
const result = await captureArtifact({
  input: ".artifacts/mockups/context-breakdown/index.html",
  yaUrl: process.env.AGENT_SERVER_URL,
  artifactOrigin: process.env.AGENT_ARTIFACT_VIEWER_ORIGIN,
  ownArtifact: false,
  commentary: true,
  interact: async ({ page }) => {
    await page.getByRole("button", { name: view, exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Context usage" });
    await expect(dialog).toBeVisible();
    const box = await dialog.boundingBox();
    const width = page.viewportSize()?.width ?? 0;
    expect(box && box.x >= 0 && box.x + box.width <= width).toBe(true);
  },
});
emitCapturePreview(result);
