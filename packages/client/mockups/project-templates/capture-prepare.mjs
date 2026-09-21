import { expect } from "@playwright/test";

export default async ({ page }) => {
  await page
    .getByRole("textbox", { name: "Project name", exact: true })
    .fill("Sketch garden");
  const field = page.getByRole("textbox", { name: "What are you making?" });
  await field.fill("");
  const intent = "Make a garden drawing app.";
  let entered = "";
  for (const character of intent) {
    await field.pressSequentially(character);
    entered += character;
    await expect(field).toHaveValue(entered, { timeout: 100 });
  }
  await page.getByRole("button", { name: "Create & prepare" }).click();
  await expect(
    page.getByText("Preparing project…", { exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel("Illustrative starter canvas")).toBeVisible();
  await expect(page.locator("blockquote")).toHaveText(intent);
  await page.evaluate(() => window.scrollTo(0, 0));
};
