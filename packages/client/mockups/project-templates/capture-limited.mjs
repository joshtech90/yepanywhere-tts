import { expect } from "@playwright/test";

export default async ({ page }) => {
  await page.getByRole("button", { name: "As limited user" }).click();
  await expect(
    page.getByText("Applied automatically", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Existing directory", exact: true }),
  ).toHaveCount(0);
  await expect(page.getByRole("textbox", { name: "Create in" })).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Create & prepare" }),
  ).toBeDisabled();
  await page
    .getByRole("textbox", { name: "Project name", exact: true })
    .fill("Sketch garden");
  await expect(
    page.getByText("~/alex/sketch-garden", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Create & prepare" }),
  ).toBeEnabled();
  await page.getByRole("button", { name: "Create & prepare" }).click();
  await expect(
    page.getByRole("heading", { name: "alex / Sketch garden", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Simulate verification complete" })
    .click();
  await expect(page.getByText("Ready to build", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Back to form" }).click();
  await page.evaluate(() => window.scrollTo(0, 0));
};
