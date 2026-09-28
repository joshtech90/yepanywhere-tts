import { describe, expect, it } from "vitest";
import {
  findHtmlRootAssetReferences,
  resolveHtmlRootAssetPath,
} from "../html-root-assets.js";

const paths = (html: string, rootPath = "site/index.html") =>
  findHtmlRootAssetReferences(html, rootPath).map(
    (reference) => reference.path,
  );

describe("HTML root asset references", () => {
  it("counts only what an element loads, never a linked document", () => {
    expect(
      paths(`<!doctype html>
<html><head>
  <link rel="stylesheet" href="site.css">
  <link rel="icon" href="favicon.svg">
  <link rel="preload" as="font" href="paper.woff2">
  <script src="app.js"></script>
  <style>body{background:url(bg.png)}</style>
</head><body>
  <a href="src/server.js">source</a>
  <!-- <script src="old.js"></script> -->
  <script>document.write('<img src="written.png">')</script>
  <img src="logo.png"><video src="clip.mp4" poster="poster.jpg"></video>
  <picture><source src="wide.webp"></picture>
  <img src="https://cdn.example/x.png"><img src="data:image/png;base64,AA">
  <img src="#frag">
</body></html>`),
    ).toEqual([
      "site/site.css",
      "site/favicon.svg",
      "site/app.js",
      "site/logo.png",
      "site/clip.mp4",
      "site/poster.jpg",
      "site/wide.webp",
    ]);
  });

  it("keeps a reference only when its element loads that kind of file", () => {
    expect(
      paths(
        '<script src="config.json"></script><link rel="stylesheet" href="x.js"><img src="notes.md">',
      ),
    ).toEqual([]);
  });

  it("resolves a leading slash from the root's own directory", () => {
    expect(
      paths('<script src="/assets/app.js"></script>', "dist/index.html"),
    ).toEqual(["dist/assets/app.js"]);
    expect(resolveHtmlRootAssetPath("dist/index.html", "/../x.css")).toBe(
      "dist/x.css",
    );
    expect(resolveHtmlRootAssetPath("dist/index.html", "../img/a.png")).toBe(
      "img/a.png",
    );
    expect(
      resolveHtmlRootAssetPath("dist/index.html", "../../outside.png"),
    ).toBeNull();
    expect(
      resolveHtmlRootAssetPath("dist/index.html", "//cdn/x.js"),
    ).toBeNull();
    expect(
      resolveHtmlRootAssetPath("dist/index.html", "my%20file.png?v=1#x"),
    ).toBe("dist/my file.png");
    expect(resolveHtmlRootAssetPath("dist/index.html", "a%2Fb.png")).toBeNull();
  });

  it("reports where each value was written, quoted or not", () => {
    const html =
      "<IMG SRC=pic.png ALT=x><script src='a.js?x=1&amp;y=2'></script>";
    const references = findHtmlRootAssetReferences(html, "index.html");
    expect(
      references.map(({ path, start, end, quoted }) => ({
        path,
        written: html.slice(start, end),
        quoted,
      })),
    ).toEqual([
      { path: "pic.png", written: "pic.png", quoted: false },
      { path: "a.js", written: "a.js?x=1&amp;y=2", quoted: true },
    ]);
  });
});
