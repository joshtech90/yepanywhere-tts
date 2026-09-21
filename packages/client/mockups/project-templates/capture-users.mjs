import { expect } from "@playwright/test";

export default async ({ page }) => {
  await page
    .getByRole("button", { name: "User settings", exact: true })
    .click();
  await expect(
    page.getByRole("checkbox", { name: /App canvas/ }),
  ).toBeChecked();
  await page.getByRole("radio", { name: /^None/ }).check();
  await page.getByRole("button", { name: "As limited user" }).click();
  await expect(
    page.getByRole("heading", { name: "Project creation is unavailable" }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "User settings", exact: true })
    .click();
  await page.getByRole("radio", { name: /^Any configured template/ }).check();
  await expect(
    page.getByText(
      "Alex can choose from every enabled template, including future additions.",
    ),
  ).toBeVisible();
  await page.getByRole("radio", { name: /^Selected templates/ }).check();
  await page.getByRole("checkbox", { name: /App canvas/ }).uncheck();
  await page.getByRole("button", { name: "As limited user" }).click();
  await expect(
    page.getByRole("heading", { name: "Project creation is unavailable" }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "User settings", exact: true })
    .click();
  await page.getByRole("checkbox", { name: /App canvas/ }).check();
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByRole("status")).toContainText("Saved in this preview");
  await page
    .getByRole("button", { name: "User settings", exact: true })
    .click();
  await page
    .getByRole("heading", { name: "New projects", exact: true })
    .scrollIntoViewIfNeeded();
};
