import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { e2ePaths, expect, test } from "./fixtures.js";
import { recordUiCapture } from "./support/ui-capture.js";

test.use({ colorScheme: "dark" });

test("document links remain recognizable inside inline code", async ({
  page,
  baseURL,
}) => {
  const projectPath = join(e2ePaths.tempDir, "mockproject");
  const projectId = Buffer.from(projectPath).toString("base64url");
  const target = "gaps/sketches/quarto-aware-document-view.md";
  mkdirSync(join(projectPath, "gaps/sketches"), { recursive: true });
  writeFileSync(join(projectPath, target), "# Quarto document proposal\n");
  writeFileSync(
    join(projectPath, "link-affordance.md"),
    [
      "# Document links",
      "",
      `The proposal is in [\`${target}\`](./${target}).`,
      "",
      "Ordinary code such as `renderMarkdown` is not a link.",
      "",
      `[Read the proposal](./${target}).`,
    ].join("\n"),
  );

  for (const viewport of [
    { width: 1000, height: 600 },
    { width: 375, height: 812 },
  ]) {
    await page.setViewportSize(viewport);
    await page.goto(
      `${baseURL}/projects/${projectId}/file?path=link-affordance.md`,
    );
    const preview = page.locator(".markdown-preview");
    const link = preview.getByRole("link", { name: target, exact: true });
    await expect(link).toBeVisible();
    await page.mouse.move(0, 0);
    await expect(link).toHaveCSS("text-decoration-line", "underline");
    const linkColor = await link.evaluate(
      (node) => getComputedStyle(node).color,
    );
    await expect(link.locator("code")).toHaveCSS("color", linkColor);
    await expect(
      preview.getByText("renderMarkdown", { exact: true }),
    ).not.toHaveCSS("color", linkColor);
    await recordUiCapture(page, `markdown-links-${viewport.width}`);
    await link.focus();
    await expect(link).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(
      page.getByRole("heading", { name: "Quarto document proposal" }),
    ).toBeVisible();
  }
});
