import { expect } from "@playwright/test";
import choose from "./capture-choices.mjs";

export default async ({ page, viewport }) => {
  await page.getByRole("button", { name: "As limited user" }).click();
  await choose({ page, viewport });
  await expect(
    page.getByRole("textbox", { name: "Create in", exact: true }),
  ).toHaveCount(0);
  await expect(page.getByRole("radio", { name: /^Web page/ })).toBeVisible();
};
