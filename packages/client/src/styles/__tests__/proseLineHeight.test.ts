// @vitest-environment node

import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const indexStylesheetUrl = new URL("../index.css", import.meta.url);
const rendererStylesheetUrl = new URL("../renderers.css", import.meta.url);

describe("prose line height", () => {
  it("floors body prose so the tightest line spacing cannot overlap", async () => {
    const [indexCss, rendererCss] = await Promise.all([
      readFile(indexStylesheetUrl, "utf8"),
      readFile(rendererStylesheetUrl, "utf8"),
    ]);

    expect(indexCss).toMatch(
      /--output-prose-line-height:\s*max\(\s*1\.1em,[\s\S]*?var\(--output-prose-line-height-offset\)[\s\S]*?\);/,
    );
    expect(indexCss).toMatch(
      /--thinking-prose-line-height:\s*max\(\s*1\.1em,[\s\S]*?var\(--thinking-prose-line-height-offset\)[\s\S]*?\);/,
    );
    expect(rendererCss).toMatch(
      /\.markdown-preview \.markdown-rendered\s*\{[\s\S]*?line-height:\s*max\(\s*1\.1em,[\s\S]*?\}/,
    );
  });

  it("resolves heading line height against the heading's own font size", async () => {
    const rendererCss = await readFile(rendererStylesheetUrl, "utf8");

    // An inherited em line height computes at body size, so a wrapped heading
    // would draw its second line on top of the first.
    expect(rendererCss).toMatch(
      /\.markdown-preview \.markdown-rendered :is\(h1, h2, h3, h4, h5, h6\),[\s\S]*?\.text-block :is\(h1, h2, h3, h4, h5, h6\),[\s\S]*?line-height:\s*max\(\s*1\.15em,[\s\S]*?\}/,
    );
  });
});
