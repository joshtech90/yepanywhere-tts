import { join } from "node:path";
import { e2ePaths, expect, test } from "./fixtures.js";
import { recordUiCapture } from "./support/ui-capture.js";

const testCommands = new Set([
  "echo ya-bang-ok",
  "printf 'bang stderr explanation\\n' >&2; exit 1",
]);

test.afterEach(async ({ baseURL, request }) => {
  // Playwright retries reuse the server. A failed assertion must not leave a
  // run behind for this test's next attempt or the route tests later on.
  const project = join(e2ePaths.tempDir, "mockproject");
  const id = Buffer.from(project).toString("base64url");
  const sessionPath = `/api/projects/${id}/sessions/mock-session-001`;
  const response = await request.get(`${baseURL}${sessionPath}`);
  expect(response.ok()).toBe(true);
  const body = (await response.json()) as {
    session: {
      transcriptDisplayObjects?: Array<{
        kind: string;
        id: string;
        command?: string;
      }>;
    };
  };
  for (const object of body.session.transcriptDisplayObjects ?? []) {
    if (
      object.kind !== "bang-command" ||
      !testCommands.has(object.command ?? "")
    )
      continue;
    const deletion = await request.delete(
      `${baseURL}${sessionPath}/bang-commands/${object.id}`,
    );
    expect(deletion.ok()).toBe(true);
  }
});

/**
 * One end-to-end pass over a `!!` local command: the composer says where the
 * draft is going before it is sent, and the command runs in the project
 * without the provider seeing it.
 * Contract: topics/bang-commands.md.
 */
test("a !! draft is routed locally and its run is recorded", async ({
  page,
  baseURL,
}) => {
  const project = join(e2ePaths.tempDir, "mockproject");
  const id = Buffer.from(project).toString("base64url");
  const sessionPath = `/api/projects/${id}/sessions/mock-session-001`;
  await page.route(`**${sessionPath}`, async (route) => {
    const response = await route.fetch();
    const body = await response.json();
    body.messages.push({ id: "msg-transient-result", type: "result" });
    await route.fulfill({ response, json: body });
  });
  const providerRequests: string[] = [];
  page.on("request", (request) => {
    if (
      request.method() === "POST" &&
      request.url().endsWith(`${sessionPath}/messages`)
    )
      providerRequests.push(request.url());
  });
  // Force completion-before-receipt instead of depending on machine timing.
  await page.route(`**${sessionPath}/bang-commands`, async (route) => {
    expect(route.request().postDataJSON().placementAfterMessageId).not.toBe(
      "msg-transient-result",
    );
    const response = await route.fetch();
    await expect(
      page
        .getByRole("group", { name: "Local command run" })
        .filter({ hasText: "echo ya-bang-ok" })
        .getByText("exit 0", { exact: true }),
    ).toBeVisible();
    await route.fulfill({ response });
  });
  await page.goto(`${baseURL}/projects/${id}/sessions/mock-session-001`);

  const composer = page.locator("textarea[data-composer-input]").first();
  await expect(composer).toBeVisible();
  await composer.pressSequentially("!!echo ya-bang-ok", { delay: 15 });

  // Routing is shown before submission, never inferred.
  await expect(
    page.getByText("!! local command", { exact: false }),
  ).toBeVisible();

  const receipt = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      response.url().endsWith(`${sessionPath}/bang-commands`),
  );
  await composer.press("Enter");
  const block = page.getByRole("group", { name: "Local command run" }).first();
  await expect(block.getByText("echo ya-bang-ok")).toBeVisible();
  await expect(composer).toHaveValue("");

  const finished = page
    .getByRole("group", { name: "Local command run" })
    .first();
  await expect(finished.getByText("exit 0")).toBeVisible({ timeout: 15000 });
  await expect(
    finished.getByRole("button", { name: "Hide output" }),
  ).toBeVisible();
  // The command can finish over the activity stream before its held POST
  // response settles. Reload only after the receipt clears the recovery draft.
  await receipt;
  await expect
    .poll(() =>
      page.evaluate(() =>
        localStorage.getItem("draft-message-mock-session-001"),
      ),
    )
    .toBeNull();
  await page.unroute(`**${sessionPath}/bang-commands`);
  await page.reload();
  await expect(finished.getByText("exit 0")).toBeVisible();
  await expect(composer).toHaveValue("");

  // Exercise deletion through the block's own action as well as the
  // afterEach cleanup used when an earlier assertion fails.
  await finished.getByRole("button", { name: "Delete" }).click();
  await expect(finished).toHaveCount(0);

  await composer.pressSequentially(
    "!!printf 'bang stderr explanation\\n' >&2; exit 1",
    { delay: 15 },
  );
  await composer.press("Enter");
  await expect(finished.getByText("exit 1", { exact: true })).toBeVisible();
  await expect(
    finished.locator("pre").filter({ hasText: "bang stderr explanation" }),
  ).toBeVisible();
  await expect(
    finished.getByRole("button", { name: "Hide output" }),
  ).toBeVisible();
  for (const viewport of [
    { width: 1200, height: 600 },
    { width: 375, height: 812 },
  ]) {
    await page.setViewportSize(viewport);
    await finished.scrollIntoViewIfNeeded();
    await recordUiCapture(page, `bang-error-${viewport.width}`, viewport);
  }
  expect(providerRequests).toEqual([]);
  await finished.getByRole("button", { name: "Delete" }).click();
  await expect(finished).toHaveCount(0);
});
