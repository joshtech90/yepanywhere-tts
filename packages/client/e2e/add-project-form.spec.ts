import { expect, test } from "./fixtures.js";

test.describe("Add project form", () => {
  test("replaces the default name through real key-by-key typing", async ({
    page,
    baseURL,
  }) => {
    await page.goto(`${baseURL}/projects`);
    await page.getByRole("button", { name: "Add Project" }).click();
    await page
      .getByRole("textbox", { name: "Project path" })
      .pressSequentially("/tmp/my-project", { delay: 10 });

    const name = page.getByRole("textbox", { name: "Name" });
    await expect(name).toHaveValue("my-project");

    await name.click();
    await name.press("End");
    for (const _ of "my-project") await name.press("Backspace");
    await expect(name).toHaveValue("");
    await name.pressSequentially("Sketch", { delay: 10 });
    await expect(name).toHaveValue("Sketch");

    // A field left empty shows the default again once focus leaves it.
    for (const _ of "Sketch") await name.press("Backspace");
    await expect(name).toHaveValue("");
    await name.press("Tab");
    await expect(name).toHaveValue("my-project");
  });
});
