import { describe, expect, it } from "vitest";
import {
  containsLinkifiableUrl,
  linkifyToHtml,
  splitUrlSegments,
} from "./linkify.js";

describe("splitUrlSegments", () => {
  it("returns one text segment when there is no URL", () => {
    expect(splitUrlSegments("plain words only")).toEqual([
      { type: "text", text: "plain words only" },
    ]);
  });

  it("links an https URL and keeps surrounding text", () => {
    expect(splitUrlSegments("see https://example.com/a for details")).toEqual([
      { type: "text", text: "see " },
      {
        type: "url",
        text: "https://example.com/a",
        href: "https://example.com/a",
      },
      { type: "text", text: " for details" },
    ]);
  });

  it("excludes trailing sentence punctuation", () => {
    const segments = splitUrlSegments("go to https://example.com/x.");
    expect(segments[1]).toEqual({
      type: "url",
      text: "https://example.com/x",
      href: "https://example.com/x",
    });
    expect(segments[2]).toEqual({ type: "text", text: "." });
  });

  it("keeps balanced parens but drops an unbalanced closer", () => {
    const balanced = splitUrlSegments(
      "https://en.wikipedia.org/wiki/X_(topic)",
    );
    expect(balanced[0]?.text).toBe("https://en.wikipedia.org/wiki/X_(topic)");

    const wrapped = splitUrlSegments("(see https://example.com/x)");
    expect(wrapped[1]?.text).toBe("https://example.com/x");
    expect(wrapped[2]).toEqual({ type: "text", text: ")" });
  });

  it("links www. URLs with an https href", () => {
    const segments = splitUrlSegments("try www.example.org/path today");
    expect(segments[1]).toEqual({
      type: "url",
      text: "www.example.org/path",
      href: "https://www.example.org/path",
    });
  });

  it("handles multiple URLs and multiline text", () => {
    const segments = splitUrlSegments(
      "first https://a.example.com\nthen https://b.example.com done",
    );
    expect(segments.filter((s) => s.type === "url")).toHaveLength(2);
    expect(segments.at(-1)).toEqual({ type: "text", text: " done" });
  });

  it("rejects non-http(s) schemes and hostless matches", () => {
    expect(
      splitUrlSegments("javascript:alert(1) and https:// and http://nohost"),
    ).toEqual([
      {
        type: "text",
        text: "javascript:alert(1) and https:// and http://nohost",
      },
    ]);
  });

  it("suppresses a URL touching the end when the text was cut", () => {
    const cut = "read https://example.com/very/long/pa";
    expect(splitUrlSegments(cut, { suppressTrailingUrl: true })).toEqual([
      { type: "text", text: cut },
    ]);
    // Same text uncut still links.
    expect(splitUrlSegments(cut).filter((s) => s.type === "url")).toHaveLength(
      1,
    );
  });
});

describe("linkifyToHtml", () => {
  const escapeHtml = (text: string) => text.replace(/&/g, "&amp;");

  it("opens a new tab only when the surface asks for one", () => {
    const external = linkifyToHtml(
      "see https://example.test/x",
      { external: true },
      escapeHtml,
    );
    expect(external).toBe(
      'see <a href="https://example.test/x" target="_blank" rel="noopener noreferrer">https://example.test/x</a>',
    );

    const sameDocument = linkifyToHtml(
      "see https://example.test/x",
      { external: false },
      escapeHtml,
    );
    expect(sameDocument).toBe(
      'see <a href="https://example.test/x">https://example.test/x</a>',
    );
  });

  it("escapes the href, the link text, and the text around it", () => {
    expect(
      linkifyToHtml(
        "a & https://example.test/a?b=1&c=2 z",
        { external: false },
        escapeHtml,
      ),
    ).toBe(
      'a &amp; <a href="https://example.test/a?b=1&amp;c=2">https://example.test/a?b=1&amp;c=2</a> z',
    );
  });

  it("escapes text that holds no linkable URL", () => {
    expect(linkifyToHtml("a & b", { external: true }, escapeHtml)).toBe(
      "a &amp; b",
    );
  });

  it("passes segment options through", () => {
    const cut = "read https://example.test/very/long/pa";
    expect(
      linkifyToHtml(
        cut,
        { external: true, suppressTrailingUrl: true },
        escapeHtml,
      ),
    ).toBe(cut);
  });
});

describe("containsLinkifiableUrl", () => {
  it("is a cheap positive/negative pre-check", () => {
    expect(containsLinkifiableUrl("x https://a.b x")).toBe(true);
    expect(containsLinkifiableUrl("x www.a.b x")).toBe(true);
    expect(containsLinkifiableUrl("nothing here")).toBe(false);
  });
});
