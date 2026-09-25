// @vitest-environment node

import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const pageStylesheetUrl = new URL("./CockpitPage.module.css", import.meta.url);
const shortcutStylesheetUrl = new URL(
  "./CockpitShortcutHelp.module.css",
  import.meta.url,
);
const sessionDetailStylesheetUrl = new URL(
  "./CockpitSessionDetail.module.css",
  import.meta.url,
);

function rules(css: string, selector: string): string[] {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const matches = [
    ...css.matchAll(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`, "g")),
  ];
  expect(matches.length, `${selector} should have a CSS rule`).toBeGreaterThan(
    0,
  );
  return matches.map((match) => match[1] ?? "");
}

function rule(css: string, selector: string): string {
  return rules(css, selector).at(-1) ?? "";
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

  it("keeps the follow button above the mobile composer", async () => {
    const css = await readFile(sessionDetailStylesheetUrl, "utf8");
    const positionedRules = rules(css, ".followButton").filter((declarations) =>
      declarations.includes("bottom:"),
    );

    expect(positionedRules.length).toBeGreaterThan(0);
    for (const declarations of positionedRules) {
      expect(declarations).toMatch(/bottom:\s*8rem\s*;/);
    }
  });
});
