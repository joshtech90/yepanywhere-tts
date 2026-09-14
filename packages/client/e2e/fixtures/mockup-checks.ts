import { expect, type Frame, type Page } from "@playwright/test";

export async function checkMockup(page: Page | Frame, state: string) {
  await expect(
    page.getByRole("heading", { name: "Project review", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("list", { name: "Sample projects" }).getByRole("listitem"),
  ).toHaveCount(16);
  await expect(page.getByRole("status")).toHaveText(
    state === "selected"
      ? "Settings selected: Yep Anywhere"
      : "Choose a project to review. Changes stay in this preview.",
  );
  expect(
    await page.evaluate(async () => {
      await document.fonts.ready;
      return {
        font: [...document.fonts].some(
          (font) => font.family === "YA Inter" && font.status === "loaded",
        ),
        scrollable: document.documentElement.scrollHeight > innerHeight,
        overflow: document.documentElement.scrollWidth > innerWidth,
        icons: document.querySelectorAll("svg").length,
      };
    }),
  ).toEqual({ font: true, scrollable: true, overflow: false, icons: 32 });
}
