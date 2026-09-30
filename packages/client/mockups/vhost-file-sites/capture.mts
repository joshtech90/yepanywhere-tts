import { expect } from "@playwright/test";
import { captureArtifact } from "../../scripts/artifact-capture";

// share: claim a taken name, then a free one; settings: the vhost table.
const view = process.argv[2] ?? "share";
if (!["share", "settings"].includes(view))
  throw new Error("Expected share or settings");
await captureArtifact({
  input: ".artifacts/mockups/vhost-file-sites/index.html",
  out: process.argv[3],
  yaUrl: process.env.AGENT_SERVER_URL,
  artifactOrigin: process.env.AGENT_ARTIFACT_VIEWER_ORIGIN,
  ownArtifact: false,
  commentary: true,
  interact: async ({ page }) => {
    if (view === "settings") {
      await page.evaluate(() => {
        location.hash = "settings";
      });
      await expect(page.getByText("File or directory").first()).toBeAttached();
      return;
    }
    const name = page.getByRole("textbox", { name: "Address name" });
    await expect(name).toHaveValue("garden-plan");
    await name.fill("");
    let typed = "";
    for (const character of "plannotator") {
      typed += character;
      await name.pressSequentially(character);
      await expect(name).toHaveValue(typed, { timeout: 100 });
    }
    await page.getByRole("button", { name: "Serve here" }).click();
    await expect(page.getByRole("alert")).toContainText("already taken");
    await name.fill("garden");
    await page.getByRole("button", { name: "Serve here" }).click();
    await expect(page.getByText("garden.graehl.org")).toBeVisible();
  },
});
