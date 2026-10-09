// @vitest-environment node

import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const pageStylesheetUrl = new URL("./CockpitPage.module.css", import.meta.url);
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
  it("uses short navigation labels on phones instead of breaking words", async () => {
    const pageCss = await readFile(pageStylesheetUrl, "utf8");
    const phone = pageCss.slice(pageCss.indexOf("@media (width <= 700px)"));

    expect(rules(pageCss, ".labelShort")[0]).toMatch(/display:\s*none\s*;/);
    expect(rule(phone, ".labelShort")).toMatch(/display:\s*inline\s*;/);
    expect(rule(phone, ".labelLong")).toMatch(/display:\s*none\s*;/);
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

  it("cannot be shifted out of reach by focus or the file picker", async () => {
    const pageCss = await readFile(pageStylesheetUrl, "utf8");
    const detailCss = await readFile(sessionDetailStylesheetUrl, "utf8");

    // Hidden labels in the rows stay inside the transcript scroller ...
    expect(rules(detailCss, ".transcript")[0]).toMatch(
      /position:\s*relative\s*;/,
    );
    // ... and the session canvas clips instead of being a hidden scroller,
    // on every breakpoint (a phone override once kept overflow: hidden).
    const canvasRules = [
      ...pageCss.matchAll(
        /\.canvas\[data-view="session"\],\s*\.canvas\[data-view="list"\]\s*\{([^}]*)\}/g,
      ),
    ].map((match) => match[1] ?? "");
    expect(canvasRules.length).toBeGreaterThanOrEqual(2);
    for (const declarations of canvasRules) {
      expect(declarations).toMatch(/overflow:\s*clip\s*;/);
    }
  });
});
