import { expect } from "@playwright/test";

export default async ({ page }) => {
  await page.getByRole("button", { name: "App names", exact: true }).click();
  await page.getByText("Reserve a name", { exact: true }).click();
  const input = page.getByRole("textbox", { name: /^App name/ });
  await input.fill("garden");
  await page.getByRole("button", { name: "Reserve name", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("already reserved");
  await input.fill("field-notes");
  await page.getByRole("button", { name: "Reserve name", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Clear field-notes", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Clear field-notes", exact: true })
    .click();
  await page.getByRole("button", { name: "Keep reservation" }).click();
  await expect(
    page.getByRole("button", { name: "Clear field-notes", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Clear field-notes", exact: true })
    .click();
  await page.getByRole("button", { name: "Release name", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Clear field-notes", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByText("old-notes.graehl.org", { exact: true }),
  ).toBeVisible();
  await page.getByText("Reserve a name", { exact: true }).click();
  await page.evaluate(() => window.scrollTo(0, 0));
};
