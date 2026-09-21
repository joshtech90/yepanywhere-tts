import { expect } from "@playwright/test";

export default async ({ page }) => {
  await page.getByRole("button", { name: "Show template choices" }).click();
  await expect(
    page.getByRole("group", { name: "Choose a template" }),
  ).toBeVisible();
  await page.getByRole("radio", { name: /^Web page/ }).check();
  await expect(
    page.getByRole("heading", {
      name: "Web page",
      exact: true,
      includeHidden: true,
    }),
  ).toBeAttached();
  await page
    .getByRole("textbox", { name: "Project name", exact: true })
    .fill("My idea");
  await page.getByRole("radio", { name: /^App canvas/ }).check();
  await expect(
    page.getByRole("textbox", { name: "Project name", exact: true }),
  ).toHaveValue("My idea");
  await page.evaluate(() => window.scrollTo(0, 0));
};
