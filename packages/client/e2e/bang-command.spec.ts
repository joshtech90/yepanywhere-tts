import { join } from "node:path";
import { e2ePaths, expect, test } from "./fixtures.js";

/**
 * One end-to-end pass over a `!!` local command: the composer says where the
 * draft is going before it is sent, and the command runs in the project
 * without the provider seeing it.
 * Contract: topics/bang-commands.md.
 *
 * The reload is not incidental. A finished run does not reach the live page
 * today (gaps/bang-run-completion-does-not-reach-the-live-page.md), so the
 * finished state is asserted after reloading; when that is fixed, assert it
 * directly instead.
 */
test("a !! draft is routed locally and its run is recorded", async ({
  page,
  baseURL,
}) => {
  const project = join(e2ePaths.tempDir, "mockproject");
  const id = Buffer.from(project).toString("base64url");
  await page.goto(`${baseURL}/projects/${id}/sessions/mock-session-001`);

  const composer = page.locator("textarea[data-composer-input]").first();
  await expect(composer).toBeVisible();
  await composer.fill("!!echo ya-bang-ok");

  // Routing is shown before submission, never inferred.
  await expect(
    page.getByText("!! local command", { exact: false }),
  ).toBeVisible();

  await composer.press("Enter");
  const block = page.getByRole("group", { name: "Local command run" }).first();
  await expect(block.getByText("echo ya-bang-ok")).toBeVisible();
  await expect(composer).toHaveValue("");

  await page.reload();
  const finished = page
    .getByRole("group", { name: "Local command run" })
    .first();
  await expect(finished.getByText("exit 0")).toBeVisible({ timeout: 15000 });

  // Runs persist and the suite shares one server, so leave the history as
  // this test found it — the !! Commands view asserts elsewhere that it is
  // empty. Deleting through the block's own action covers that path too.
  await finished.getByRole("button", { name: "Delete" }).click();
  await expect(finished).toHaveCount(0);
});
