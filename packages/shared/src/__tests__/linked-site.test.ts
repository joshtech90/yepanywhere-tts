import { describe, expect, it } from "vitest";
import {
  findLinkedReferences,
  type LinkedSiteInspector,
  walkLinkedSite,
} from "../linked-site.js";

/** An inspector over an in-memory tree; a path absent from it is missing. */
function tree(files: Record<string, string>): LinkedSiteInspector {
  return async (path, document) =>
    path in files ? (document ? { content: files[path] } : {}) : null;
}

describe("linked references", () => {
  it("counts every HTML reference, not only what an element loads", () => {
    expect(
      findLinkedReferences(
        `<link rel="stylesheet" href="site.css">
<a href="../../topics/speech-mt.md#intro">topic</a>
<img src="fig.png" srcset="fig@2x.png 2x, fig@3x.png 3x">
<div style="background: url('bg.png')"></div>
<a href="https://example.com/x">external</a><a href="#top">top</a>
<a href="a&amp;b.html">entity</a>`,
        "html",
      ),
    ).toEqual([
      "site.css",
      "../../topics/speech-mt.md#intro",
      "fig.png",
      "fig@2x.png",
      "fig@3x.png",
      "https://example.com/x",
      "#top",
      "a&b.html",
      "bg.png",
    ]);
  });

  it("reads Markdown links, images and definitions outside code", () => {
    expect(
      findLinkedReferences(
        `See [the topic](../topics/x.md "title") and ![fig](img/f.png).

[ref]: notes/ref.md

\`\`\`md
[not a link](code-only.md)
\`\`\`

<img src="inline.svg">
`,
        "markdown",
      ),
    ).toEqual(["../topics/x.md", "img/f.png", "notes/ref.md", "inline.svg"]);
  });

  it("reads CSS urls and imports", () => {
    expect(
      findLinkedReferences(
        `@import "base.css"; .a { background: url(img/a.png) }`,
        "css",
      ),
    ).toEqual(["img/a.png", "base.css"]);
  });
});

describe("walkLinkedSite", () => {
  it("serves a link above the root's folder at the URL a browser asks for", async () => {
    const site = await walkLinkedSite(
      "/p/research/sr/report.html",
      tree({
        "/p/research/sr/report.html": `<a href="../../topics/speech-mt.md">topic</a>
<img src="figs/a.png">`,
        "/p/topics/speech-mt.md":
          "[back](../research/sr/report.html) [n](next.md)",
        "/p/topics/next.md": "leaf",
        "/p/research/sr/figs/a.png": "",
      }),
    );
    expect(Object.fromEntries(site.urls)).toEqual({
      "/": "/p/research/sr/report.html",
      "/report.html": "/p/research/sr/report.html",
      "/topics/speech-mt.md": "/p/topics/speech-mt.md",
      "/figs/a.png": "/p/research/sr/figs/a.png",
      "/research/sr/report.html": "/p/research/sr/report.html",
      "/topics/next.md": "/p/topics/next.md",
    });
    expect(site.files.map((file) => file.path)).toEqual([
      "/p/research/sr/report.html",
      "/p/topics/speech-mt.md",
      "/p/research/sr/figs/a.png",
      "/p/topics/next.md",
    ]);
    expect(site.truncated).toBe(false);
  });

  it("skips missing targets and keeps the first file to claim a URL", async () => {
    const site = await walkLinkedSite(
      "/p/sr/index.html",
      tree({
        "/p/sr/index.html": `<a href="gone.md">x</a>
<a href="topics/a.md">near</a><a href="../topics/a.md">far</a>`,
        "/p/sr/topics/a.md": "near",
        "/p/topics/a.md": "far",
      }),
    );
    expect(site.urls.get("/topics/a.md")).toBe("/p/sr/topics/a.md");
    expect(site.files.map((file) => file.path)).not.toContain("/p/topics/a.md");
    expect(site.urls.has("/gone.md")).toBe(false);
  });

  it("resolves a leading slash from the root's folder", async () => {
    const site = await walkLinkedSite(
      "/p/dist/index.html",
      tree({
        "/p/dist/index.html": `<script src="/assets/app.js"></script>`,
        "/p/dist/assets/app.js": "",
      }),
    );
    expect(site.urls.get("/assets/app.js")).toBe("/p/dist/assets/app.js");
  });

  it("stops at its limits and says so", async () => {
    const site = await walkLinkedSite(
      "/p/a.md",
      tree({
        "/p/a.md": "[b](b.md) [c](c.md) [d](d.md)",
        "/p/b.md": "",
        "/p/c.md": "",
        "/p/d.md": "",
      }),
      { maxFiles: 3, maxDocuments: 10 },
    );
    expect(site.files).toHaveLength(3);
    expect(site.truncated).toBe(true);
  });

  it("serves nothing when the root is missing", async () => {
    const site = await walkLinkedSite("/p/missing.html", tree({}));
    expect(site.files).toEqual([]);
    expect(site.urls.size).toBe(0);
  });
});
