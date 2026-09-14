import { mkdirSync } from "node:fs";
import { join } from "node:path";
import type { Page } from "@playwright/test";
import { e2ePaths, expect, test } from "./fixtures.js";

const mockProjectPath = join(e2ePaths.tempDir, "mockproject");
const projectId = Buffer.from(mockProjectPath).toString("base64url");
const sessionId = "code-fence-mermaid-001";

test.use({ serviceWorkers: "block" });

async function dismissOnboardingIfVisible(page: Page) {
  const skip = page.locator(".onboarding-skip-all");
  if (
    await skip
      .waitFor({ state: "visible", timeout: 750 })
      .then(() => true)
      .catch(() => false)
  ) {
    await skip.click();
  }
}

/**
 * Frames the block under test at the viewport the name records, rather than a
 * full-page capture that would scroll a 600px-tall viewport past the diagram.
 */
async function capture(page: Page, name: string) {
  const artifactDir = process.env.YEP_UI_CAPTURE_DIR;
  if (!artifactDir) return;
  mkdirSync(artifactDir, { recursive: true });
  await page
    .locator("[data-ya-code-block]")
    .first()
    .scrollIntoViewIfNeeded()
    .catch(() => {});
  await page.mouse.move(1, 1);
  await page.waitForTimeout(300);
  await page.screenshot({
    animations: "disabled",
    path: join(artifactDir, `${name}.png`),
  });
}

async function openTranscript(page: Page, baseURL: string) {
  await page.goto(`${baseURL}/projects/${projectId}/sessions/${sessionId}`);
  await dismissOnboardingIfVisible(page);
  await expect(page.locator("[data-ya-code-rendered] svg")).toBeVisible({
    timeout: 20000,
  });
}

test("renders a mermaid fence as a diagram and labels other fences", async ({
  page,
  baseURL,
}) => {
  await page.setViewportSize({ width: 1000, height: 600 });
  await openTranscript(page, baseURL);

  // The mermaid block shows the diagram; its source is retained behind the
  // source/render toggle.
  const block = page.locator("[data-ya-code-block]").first();
  await expect(block).toHaveAttribute("data-ya-code-view", "rendered");
  await expect(block.locator("pre")).toBeHidden();

  // Every other fence keeps its highlighted source and gains a language label.
  await expect(
    page.locator('pre[data-ya-code-language="typescript"]'),
  ).toBeVisible();

  await capture(page, "code-fence-mermaid-desktop-1000x600");

  // The toggle fades in on hover like the other Σ affordances, and its label
  // names the diagram so it cannot be confused with the message's own
  // source/rendered toggle.
  const toggle = block.locator("[data-ya-code-toggle]");
  await block.hover();
  await expect(toggle).toHaveAccessibleName("Show diagram source");
  await toggle.click();
  await expect(block).toHaveAttribute("data-ya-code-view", "source");
  await expect(block.locator("pre")).toBeVisible();
  await capture(page, "code-fence-mermaid-source-desktop-1000x600");

  await block.hover();
  await expect(toggle).toHaveAccessibleName("Show diagram");
  await toggle.click();
  await expect(block).toHaveAttribute("data-ya-code-view", "rendered");
});

test("renders a mermaid fence at phone width", async ({ page, baseURL }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await openTranscript(page, baseURL);

  const diagram = page.locator("[data-ya-code-rendered] svg").first();
  await expect(diagram).toBeVisible();

  // A wide diagram must stay inside the viewport rather than widening it.
  const width = await diagram.evaluate(
    (node) => node.getBoundingClientRect().width,
  );
  expect(width).toBeLessThanOrEqual(375);

  await capture(page, "code-fence-mermaid-mobile-375x812");
});

test("renders a mermaid fence in a markdown file preview", async ({
  page,
  baseURL,
}) => {
  await page.setViewportSize({ width: 1000, height: 600 });
  await page.goto(
    `${baseURL}/projects/${projectId}/file?path=diagram-notes.md`,
  );
  await dismissOnboardingIfVisible(page);

  await expect(
    page.locator(".markdown-rendered [data-ya-code-rendered] svg"),
  ).toBeVisible({ timeout: 20000 });
  await capture(page, "code-fence-mermaid-file-preview-desktop-1000x600");
});
