// @vitest-environment node

import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const pageStylesheetUrl = new URL("./CockpitPage.module.css", import.meta.url);
const shortcutStylesheetUrl = new URL(
  "./CockpitShortcutHelp.module.css",
  import.meta.url,
);

function rule(css: string, selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const matches = [
    ...css.matchAll(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`, "g")),
  ];
  expect(matches.length, `${selector} should have a CSS rule`).toBeGreaterThan(
    0,
  );
  return matches.at(-1)?.[1] ?? "";
}

describe("Cockpit mobile navigation layout", () => {
  it("wraps every visible navigation label instead of clipping it", async () => {
    const [pageCss, shortcutCss] = await Promise.all([
      readFile(pageStylesheetUrl, "utf8"),
      readFile(shortcutStylesheetUrl, "utf8"),
    ]);

    for (const declarations of [
      rule(pageCss, ".navigationItem > span:last-child"),
      rule(shortcutCss, ".trigger > span:last-child"),
    ]) {
      expect(declarations).toMatch(/white-space:\s*normal\s*;/);
      expect(declarations).not.toMatch(/text-overflow:\s*ellipsis\s*;/);
    }
  });
});
