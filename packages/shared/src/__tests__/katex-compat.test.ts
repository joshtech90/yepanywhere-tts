import { describe, expect, it } from "vitest";
import { normalizeTexForKatex, paperKatexMacros } from "../katex-compat.js";

/** Contract: topics/rich-text-rendering.md § Math delimiter parity. */

describe("normalizeTexForKatex", () => {
  it("rewrites xcolor model arguments into KaTeX's hex form", () => {
    expect(normalizeTexForKatex("{\\color[rgb]{0.7,0,0}\\times}")).toBe(
      "{\\color{#b30000}\\times}",
    );
    expect(normalizeTexForKatex("\\textcolor[RGB]{0,128,255}{x}")).toBe(
      "\\textcolor{#0080ff}{x}",
    );
    expect(normalizeTexForKatex("\\colorbox[HTML]{FFCC00}{y}")).toBe(
      "\\colorbox{#FFCC00}{y}",
    );
    expect(normalizeTexForKatex("\\color[gray]{0.5}z")).toBe(
      "\\color{#808080}z",
    );
  });

  it("leaves unknown models and plain TeX untouched", () => {
    expect(normalizeTexForKatex("\\color[wave]{500}x")).toBe(
      "\\color[wave]{500}x",
    );
    expect(normalizeTexForKatex("x_{[i]}+\\color{red}y")).toBe(
      "x_{[i]}+\\color{red}y",
    );
  });

  it("drops \\pagecolor, which has no inline meaning", () => {
    expect(normalizeTexForKatex("\\pagecolor[rgb]{1,1,1}x")).toBe("x");
  });
});

describe("paper KaTeX macros", () => {
  it("returns an independent table per render", () => {
    const first = paperKatexMacros();
    first["\\alpha"] = "\\beta";
    expect(paperKatexMacros()["\\alpha"]).toBeUndefined();
    expect(paperKatexMacros()["\\textsc"]).toBe("\\text{#1}");
  });
});
