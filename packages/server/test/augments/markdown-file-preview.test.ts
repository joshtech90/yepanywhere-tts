import { describe, expect, it } from "vitest";
import { renderMarkdownFilePreview } from "../../src/augments/markdown-file-preview.js";

describe("renderMarkdownFilePreview — document anchors", () => {
  const markdown = [
    "# Notes",
    "",
    "[jump](#notes-1)",
    "",
    "# Notes",
    "",
    "Target text",
    "",
    "# Notes",
  ].join("\n");

  it("gives a whole preview in-page links", async () => {
    const html = await renderMarkdownFilePreview(markdown, {}, 1, null, "full");

    expect(html).toContain('<h1 id="user-content-notes">');
    expect(html).toContain('<a href="#user-content-notes-1">jump</a>');
    expect(html).toContain('<h1 id="user-content-notes-2">');
  });

  it("numbers headings across range parts as a single render does", async () => {
    const full = await renderMarkdownFilePreview(
      markdown,
      {},
      1,
      { start: 5, end: 5 },
      "full",
    );
    const range = await renderMarkdownFilePreview(
      markdown,
      {},
      1,
      { start: 5, end: 5 },
      "range",
    );

    for (const html of [full, range]) {
      expect(html).toContain('<h1 id="user-content-notes-1">');
      expect(html.match(/id="user-content-notes-1"/g)).toHaveLength(1);
    }
    expect(full).toContain('<h1 id="user-content-notes">');
    expect(full).toContain('<h1 id="user-content-notes-2">');
  });
});
