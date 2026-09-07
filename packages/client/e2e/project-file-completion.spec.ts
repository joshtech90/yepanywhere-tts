import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { e2ePaths, expect, test } from "./fixtures.js";

test("@ completion is explicit, distinguishes directories, and accepts only Tab or click", async ({
  page,
  baseURL,
}) => {
  const project = join(e2ePaths.tempDir, "mockproject");
  await mkdir(join(project, "writing"), { recursive: true });
  await writeFile(join(project, "writing", "draft.md"), "draft");
  await writeFile(join(project, "writing", "ignored.md"), "ignored");
  await writeFile(join(project, "writing", ".gitignore"), "ignored.md\n");
  const id = Buffer.from(project).toString("base64url");
  await page.setViewportSize({ width: 1000, height: 600 });
  const requests: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes("/file-completion?"))
      requests.push(request.url());
  });
  await page.goto(`${baseURL}/projects/${id}/sessions/mock-session-001`);
  const textarea = page.locator("textarea[data-composer-input]").first();
  await expect(textarea).toBeVisible();
  await textarea.fill("Read @");
  await page.waitForTimeout(150);
  await textarea.press("w");
  await page.waitForTimeout(150);
  expect(requests).toHaveLength(0);
  await textarea.press("r");
  const menu = page.getByRole("listbox", {
    name: "Project files and directories",
  });
  await expect(
    menu.getByRole("option", { name: "draft.md writing/ file" }),
  ).toBeVisible();
  await expect(menu.getByText("ignored.md", { exact: true })).toHaveCount(0);
  await expect(menu.getByRole("option", { name: "writing dir" })).toBeVisible();
  const archive = resolve(
    process.cwd(),
    "../../.artifacts/ui-testing/2026-09-06-file-completion",
  );
  await mkdir(archive, { recursive: true });
  await expect(page.getByText("Server changed", { exact: false })).toHaveCount(
    0,
  );
  await page.screenshot({ path: join(archive, "desktop.png") });
  await textarea.press("ArrowDown");
  await textarea.press("Space");
  await expect(textarea).toHaveValue("Read @wr ");
  await textarea.fill("Read @wr");
  await menu.getByRole("option", { name: "writing dir" }).click();
  await expect(textarea).toHaveValue("Read writing/ ");
  await textarea.press("Space");
  await expect(textarea).toHaveValue("Read writing/ ");
  await textarea.press("Shift+Enter");
  // The typed space is ordinary after consuming the provisional separator.
  await expect(textarea).toHaveValue("Read writing/ \n");
  await textarea.fill("Read @wr");
  await expect(menu).toBeVisible();
  await page.setViewportSize({ width: 375, height: 812 });
  await page.screenshot({ path: join(archive, "mobile.png") });
  await menu.getByRole("option", { name: "draft.md writing/ file" }).click();
  await expect(textarea).toHaveValue("Read writing/draft.md ");
  await textarea.press("Shift+Enter");
  await expect(textarea).toHaveValue("Read writing/draft.md\n");
  await page.goto(`${baseURL}/new-session?projectId=${id}`);
  const newComposer = page.locator("textarea[data-composer-input]").first();
  await newComposer.fill("@");
  await expect(
    menu.getByRole("option", { name: "draft.md writing/ file" }),
  ).toBeVisible();
  await menu.getByRole("option", { name: "draft.md writing/ file" }).click();
  await expect(newComposer).toHaveValue("writing/draft.md ");
});
