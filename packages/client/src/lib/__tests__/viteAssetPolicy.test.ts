import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { cspPlugin, shouldInlineClientAsset } from "../../../vite-plugin-csp";

describe("client CSP injection", () => {
  const plugin = cspPlugin({ isRemote: true });
  const handler = (
    plugin.transformIndexHtml as {
      handler: (
        html: string,
        context: { filename: string; path: string },
      ) => string | undefined;
    }
  ).handler;

  it("injects the strict policy into the app entry", () => {
    const out = handler("<html><head></head></html>", {
      filename: "/repo/packages/client/remote.html",
      path: "/remote.html",
    });
    expect(out).toContain('http-equiv="Content-Security-Policy"');
    expect(out).toContain("script-src 'self'");
  });

  it("leaves play.html to its own permissive policy", () => {
    const html = "<html><head></head></html>";
    expect(
      handler(html, {
        filename: "/repo/packages/client/play.html",
        path: "/play.html",
      }),
    ).toBe(html);
  });

  it("closes play.html's own policy to frames, forms, and foreign bases", () => {
    const page = readFileSync(
      join(import.meta.dirname, "../../../play.html"),
      "utf8",
    );
    const policy = /http-equiv="Content-Security-Policy"\s+content="([^"]*)"/
      .exec(page)?.[1]
      ?.split(";")
      .map((directive) => directive.trim());
    expect(policy).toContain("frame-src 'none'");
    expect(policy).toContain("form-action 'none'");
    expect(policy).toContain("base-uri 'self'");
    expect(policy).toContain("object-src 'none'");
  });
});

describe("client Vite asset policy", () => {
  it("keeps fonts on the same origin required by the CSP", () => {
    expect(shouldInlineClientAsset("KaTeX_Size3-Regular.woff2")).toBe(false);
    expect(shouldInlineClientAsset("font.ttf?url")).toBe(false);
  });

  it("leaves non-font inlining at Vite's default", () => {
    expect(shouldInlineClientAsset("small-icon.png")).toBeUndefined();
  });
});
