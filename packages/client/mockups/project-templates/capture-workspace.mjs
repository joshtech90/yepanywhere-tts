import { expect } from "@playwright/test";

export default async ({ page }) => {
  await page
    .getByRole("button", { name: "User settings", exact: true })
    .click();
  await expect(page.getByRole("textbox", { name: /^Create in/ })).toHaveValue(
    "~/alex",
  );
  await expect(
    page.getByRole("radio", { name: /^Personal directory/ }),
  ).toBeChecked();
  await page.getByRole("radio", { name: /^Current project only/ }).check();
  await expect(
    page.getByText(
      /Writes stay inside the active project, including an outside project/,
    ),
  ).toBeVisible();
  await page.getByRole("radio", { name: /^Personal directory/ }).check();
  await page.evaluate(() => window.scrollTo(0, 0));
};
