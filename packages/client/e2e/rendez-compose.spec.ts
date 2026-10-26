import { readFile, readlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { e2ePaths, expect, test } from "./fixtures.js";
import { recordUiCapture } from "./support/ui-capture.js";

test.use({ serviceWorkers: "block" });

test("active-compose attaches to a new-session draft while real typing continues", async ({
  page,
  baseURL,
}) => {
  test.skip(process.platform === "win32", "Rendez requires POSIX symlinks");
  test.setTimeout(60_000);
  const project = join(e2ePaths.tempDir, "mockproject");
  const projectId = Buffer.from(project).toString("base64url");
  const settings = (
    await (await page.request.get(`${baseURL}/api/settings`)).json()
  ).settings;
  const original = settings.rendez ?? { enabled: false, projects: {} };
  const headers = { "X-Yep-Anywhere": "true" };
  const draft = async () =>
    (
      await (
        await page.request.post(`${baseURL}/api/drafts/read`, {
          headers,
          data: { slot: { kind: "new-session" } },
        })
      ).json()
    ).snapshot;
  try {
    expect(
      (
        await page.request.put(`${baseURL}/api/settings`, {
          headers,
          data: {
            rendez: {
              ...original,
              projects: { ...original.projects, [project]: true },
            },
          },
        })
      ).ok(),
    ).toBe(true);
    await page.setViewportSize({ width: 1200, height: 600 });
    await page.goto(`${baseURL}/new-session?projectId=${projectId}`);
    const input = page.locator("[data-composer-input]").first();
    await expect(input).toBeVisible();
    await expect
      .poll(async () =>
        readlink(join(project, ".rendez", "active-compose")).catch(
          () => "missing",
        ),
      )
      .toContain("ya-new-session-draft");
    await input.pressSequentially("Explain this screenshot", { delay: 15 });
    await expect
      .poll(async () => (await draft()).payload.fields.text, { timeout: 15000 })
      .toBe("Explain this screenshot");
    await writeFile(
      join(project, ".rendez", "active-compose", "compose-shot.png"),
      await readFile(new URL("../public/icon-192.png", import.meta.url)),
    );
    let value = "Explain this screenshot";
    for (const character of " while I keep typing this additional sentence.") {
      value += character;
      await input.pressSequentially(character, { delay: 40 });
      await expect(input).toHaveValue(value, { timeout: 100 });
    }
    await expect
      .poll(async () => (await draft()).payload.attachments.length, {
        timeout: 15000,
      })
      .toBe(1);
    await expect(
      page.getByText("compose-shot.png", { exact: true }).first(),
    ).toBeVisible({ timeout: 15000 });
    await expect(input).toHaveValue(value);
    await expect(input).toBeFocused();
    await recordUiCapture(page, "rendez-compose-desktop");
    await page.setViewportSize({ width: 375, height: 812 });
    await recordUiCapture(page, "rendez-compose-phone");
    await page.goto(`${baseURL}/projects/${projectId}`);
    await expect
      .poll(async () => readlink(join(project, ".rendez", "active-compose")))
      .toBe("latest-session");
    await page.goto(`${baseURL}/new-session?projectId=${projectId}`);
    await expect(input).toHaveValue(value);
    await expect(
      page.getByText("compose-shot.png", { exact: true }).first(),
    ).toBeVisible();
  } finally {
    await page.goto("about:blank");
    expect(
      (
        await page.request.put(`${baseURL}/api/settings`, {
          headers,
          data: { rendez: original },
        })
      ).ok(),
    ).toBe(true);
    const read = await (
      await page.request.post(`${baseURL}/api/drafts/read`, {
        headers,
        data: { slot: { kind: "new-session" } },
      })
    ).json();
    await page.request.post(`${baseURL}/api/drafts/clear`, {
      headers,
      data: {
        slot: { kind: "new-session" },
        ticket: read.ticket,
        baseRevision: read.snapshot.revision,
        operationId: crypto.randomUUID(),
      },
    });
  }
});
