import { expect, test } from "./fixtures.js";
import { recordUiCapture } from "./support/ui-capture.js";

for (const viewport of [
  { width: 1200, height: 600 },
  { width: 375, height: 812 },
]) {
  test(`issue credential entry stays empty until typed at ${viewport.width}px`, async ({
    page,
    baseURL,
  }) => {
    await page.setViewportSize(viewport);
    await page.route("**/api/issues/settings", (route) =>
      route.fulfill({
        json: {
          settings: {
            enabled: true,
            scope: "viewed",
            recentDays: 7,
            confirmation: { enabled: true, jiraSite: "", jiraEmail: "" },
          },
          knownJiraProjects: [],
        },
      }),
    );
    const credentials = [
      {
        provider: "github",
        active: "gh auth token",
        sources: [{ name: "gh auth token", kind: "cli", present: true }],
      },
      {
        provider: "jira",
        active: "Key stored in Settings",
        sources: [
          { name: "Key stored in Settings", kind: "stored", present: true },
        ],
      },
    ];
    let saved: unknown;
    await page.route("**/api/issues/credentials", async (route) => {
      if (route.request().method() === "PUT")
        saved = route.request().postDataJSON();
      await route.fulfill({ json: { credentials } });
    });
    await page.goto(`${baseURL}/settings/issues`);
    for (const provider of ["GitHub", "Jira"]) {
      const group = page.getByRole("group", { name: `${provider} credential` });
      const input = group.locator("input");
      await expect(input).toHaveValue("");
      await expect(input).toHaveAttribute("autocomplete", "new-password");
      await expect(input).toHaveAttribute("data-1p-ignore");
      await expect(input).toHaveAttribute("data-lpignore", "true");
      await input.focus();
      let typed = "";
      for (const character of "test-api-token") {
        typed += character;
        await input.pressSequentially(character);
        await expect(input).toHaveValue(typed, { timeout: 100 });
      }
      await group.getByRole("button", { name: "Save key" }).click();
      await expect(input).toHaveValue("");
      expect(saved).toEqual({ provider: provider.toLowerCase(), key: typed });
    }
    await page
      .getByRole("group", { name: "GitHub credential" })
      .scrollIntoViewIfNeeded();
    await recordUiCapture(
      page,
      `issues-credentials-${viewport.width}`,
      viewport,
    );
  });
}
