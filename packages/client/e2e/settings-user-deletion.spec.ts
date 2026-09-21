import { expect, test } from "./fixtures.js";
import { recordUiCapture } from "./support/ui-capture.js";

test.use({ serviceWorkers: "block" });

for (const viewport of [
  { name: "desktop", width: 1200, height: 600 },
  { name: "phone", width: 375, height: 812 },
]) {
  test(`confirms user deletion on ${viewport.name}`, async ({
    page,
    baseURL,
  }) => {
    await page.setViewportSize(viewport);
    let deleted = false;
    let deletionRequests = 0;
    await page.route("**/api/users", (route) =>
      route.fulfill({
        json: {
          enabled: true,
          users: deleted
            ? []
            : [
                {
                  username: "alice",
                  newSessionProjects: [],
                  joinProjects: [],
                  viewProjects: [],
                  joinStaleOffsetMinutes: 0,
                  lock: {},
                  createdAt: "2026-09-21T00:00:00.000Z",
                },
              ],
        },
      }),
    );
    await page.route("**/api/users/alice", (route) => {
      expect(route.request().method()).toBe("DELETE");
      deletionRequests++;
      deleted = true;
      return route.fulfill({ json: { success: true } });
    });

    await page.goto(`${baseURL}/settings/users`);
    const remove = page.getByRole("button", { name: "Delete", exact: true });
    await expect(remove).toBeVisible();
    const canceled = page.waitForEvent("dialog");
    const cancelClick = remove.click();
    const cancelDialog = await canceled;
    expect(cancelDialog.type()).toBe("confirm");
    expect(cancelDialog.message()).toBe(
      "Delete user alice? This removes their account, grants and usage history. Project directories and files are kept.",
    );
    await cancelDialog.dismiss();
    await cancelClick;
    expect(deletionRequests).toBe(0);
    await expect(page.getByText("alice", { exact: true })).toBeVisible();
    await recordUiCapture(page, `user-delete-canceled-${viewport.name}`);

    const confirmed = page.waitForEvent("dialog");
    const confirmClick = remove.click();
    await (await confirmed).accept();
    await confirmClick;
    await expect(page.getByText("alice", { exact: true })).toHaveCount(0);
    expect(deletionRequests).toBe(1);
  });
}
