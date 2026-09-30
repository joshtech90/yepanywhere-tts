import { describe, expect, it } from "vitest";
import type { ArtifactViewerStatus } from "@yep-anywhere/shared";
import {
  publicSessionLocalhostHref,
  rewriteSessionLocalhostHref,
  sessionLocalhostRewriteApplies,
  sessionToolUrls,
  sessionVhostApp,
  unmappedLoopbackPorts,
} from "./sessionVhostApps";
import { rewriteSessionAppLinksHtml } from "../components/SessionAppLinks";

const vhostConfig: ArtifactViewerStatus = {
  port: 4402,
  available: true,
  locked: false,
  defaultLocalOrigin: "http://artifacts.localhost:3400",
  localOrigin: "http://artifacts.localhost:9876",
  publicOrigin: "https://artifacts.example.org",
  vhostPublicRoot: "example.org",
  vhosts: [{ name: "plan", port: 19432 }],
};
describe("session vhost apps", () => {
  it("offers a sandboxed session's loopback server under its minted name", () => {
    const config = {
      ...vhostConfig,
      // A limited user knows no operator tokens.
      accessTokens: {},
      sessionApps: { 5173: { name: "sbx-0123", accessToken: "minted" } },
    };
    expect(
      sessionVhostApp(
        "http://127.0.0.1:5173/play?x=1#top",
        config,
        "http://localhost:3400",
      ),
    ).toEqual({
      sourceUrl: "http://127.0.0.1:5173/play?x=1#top",
      url: "http://sbx-0123.localhost:9876/play?x=1&ya_access=minted#top",
      label: "127.0.0.1:5173/play",
    });
    expect(
      sessionVhostApp(
        "http://localhost:5173/",
        config,
        "https://ya.example.org",
      )?.url,
    ).toBe("https://sbx-0123.example.org/?ya_access=minted");
    // The operator row still owns its port, and without a token is withheld.
    expect(
      sessionVhostApp(
        "http://localhost:19432/",
        {
          ...config,
          sessionApps: { 19432: { name: "sbx-9", accessToken: "x" } },
        },
        "https://ya.example.org",
      ),
    ).toBeUndefined();
  });
  it("lists loopback ports no operator row serves", () => {
    expect(
      unmappedLoopbackPorts(
        [
          "http://127.0.0.1:5173/",
          "http://localhost:19432/",
          "http://localhost/",
          "http://plan.localhost:3400/",
          "https://127.0.0.1:8443/",
          // A source-template placeholder, in its URL-encoded form.
          "http://127.0.0.1:$%7bPORT%7d/",
          "http://127.0.0.1:5173/other",
        ],
        vhostConfig,
      ),
    ).toEqual([5173, 80]);
  });
  it("adds app-scoped bearers only when the server supplies them", () => {
    expect(
      sessionVhostApp(
        "http://localhost:19432/",
        {
          ...vhostConfig,
          accessTokens: { plan: "private-token" },
        },
        "https://ya.example.org",
      )?.url,
    ).toBe("https://plan.example.org/?ya_access=private-token");
    expect(
      sessionVhostApp(
        "http://localhost:19432/",
        {
          ...vhostConfig,
          accessTokens: {},
        },
        "https://ya.example.org",
      ),
    ).toBeUndefined();
  });
  it("discovers configured artifact grants even with no vhost table", () => {
    const raw = "https://artifacts.example.org/a/bearer/review.html";
    const config = { ...vhostConfig, vhosts: [] };
    expect(
      sessionToolUrls({ content: [{ type: "tool_result", content: raw }] }),
    ).toEqual([raw]);
    expect(
      sessionVhostApp(raw, config, "https://ya.example.org")?.artifactToken,
    ).toBe("bearer");
    expect(
      sessionVhostApp(
        "https://other.example.org/a/bearer/review.html",
        config,
        "https://ya.example.org",
      ),
    ).toBeUndefined();
  });
  it("rewrites all loopback spellings and preserves path, query and fragment", () => {
    for (const host of ["localhost", "127.0.0.1", "[::1]"]) {
      expect(
        sessionVhostApp(
          `http://${host}:19432/review?q=abc#x`,
          vhostConfig,
          "http://localhost:9876",
        )?.url,
      ).toBe("http://plan.localhost:9876/review?q=abc#x");
    }
    expect(
      sessionVhostApp(
        "http://localhost:19432/",
        vhostConfig,
        "https://ya.example.net",
      )?.url,
    ).toBe("https://plan.example.org/");
  });
  it("rewrites configured localhost anchors only for public relay sessions", () => {
    const config = {
      ...vhostConfig,
      accessTokens: { plan: "private-token" },
    };
    const raw = "http://plan.localhost:19432/review?q=abc#x";
    expect(
      rewriteSessionLocalhostHref(raw, config, {
        clientUrl: "https://ya.example.org/-/relay/home/sessions/one",
        relayed: true,
      }),
    ).toBe("https://plan.example.org/review?q=abc&ya_access=private-token#x");
    for (const context of [
      { clientUrl: "https://ya.example.org/sessions/one", relayed: false },
      { clientUrl: "http://localhost:3400/sessions/one", relayed: true },
    ]) {
      expect(rewriteSessionLocalhostHref(raw, config, context)).toBe(raw);
    }
  });
  it("can always rewrite configured localhost anchors and preserves prose", () => {
    const config = {
      ...vhostConfig,
      alwaysRewriteVhostLinks: true,
      accessTokens: { plan: null },
    };
    const raw = "http://plan.localhost/path";
    const rewrite = (href: string) =>
      rewriteSessionLocalhostHref(href, config, {
        clientUrl: "http://localhost:3400/sessions/one",
        relayed: false,
      });
    expect(rewrite(raw)).toBe("https://plan.example.org/path");
    expect(
      rewriteSessionAppLinksHtml(
        `plan.localhost <a href="${raw}">plan.localhost</a>`,
        rewrite,
      ),
    ).toBe(
      'plan.localhost <a href="https://plan.example.org/path">plan.localhost</a>',
    );
  });
  it("forces an explicit public URL for any localhost subdomain", () => {
    expect(
      rewriteSessionLocalhostHref(
        "http://artifacts.localhost:3400/a/grant/report.html#results",
        vhostConfig,
        {
          clientUrl: "http://localhost:3400/sessions/one",
          relayed: false,
          force: true,
        },
      ),
    ).toBe("https://artifacts.example.org/a/grant/report.html#results");
    expect(
      rewriteSessionLocalhostHref("//reports.localhost/today", vhostConfig, {
        clientUrl: "https://ya.example.org/-/relay/home/sessions/one",
        relayed: true,
        force: true,
      }),
    ).toBe("https://reports.example.org/today");
  });
  it("decides per page whether transcript rewriting can change a destination", () => {
    const relayPage = {
      clientUrl: "https://ya.example.org/-/relay/home/sessions/one",
      relayed: true,
    };
    const directPage = {
      clientUrl: "http://localhost:3400/sessions/one",
      relayed: false,
    };
    const { vhostPublicRoot: _root, ...noRoot } = vhostConfig;
    expect(sessionLocalhostRewriteApplies(vhostConfig, relayPage)).toBe(true);
    expect(sessionLocalhostRewriteApplies(vhostConfig, directPage)).toBe(false);
    expect(
      sessionLocalhostRewriteApplies(
        { ...vhostConfig, alwaysRewriteVhostLinks: true },
        directPage,
      ),
    ).toBe(true);
    expect(
      sessionLocalhostRewriteApplies(vhostConfig, {
        ...directPage,
        force: true,
      }),
    ).toBe(true);
    expect(sessionLocalhostRewriteApplies(noRoot, relayPage)).toBe(false);
    expect(sessionLocalhostRewriteApplies(undefined, relayPage)).toBe(false);
  });
  it("offers an explicit public URL only where a public destination exists", () => {
    const directPage = {
      clientUrl: "http://localhost:3400/sessions/one",
      relayed: false,
    };
    expect(
      publicSessionLocalhostHref(
        "http://reports.localhost/today",
        vhostConfig,
        directPage,
      ),
    ).toBe("https://reports.example.org/today");
    expect(
      publicSessionLocalhostHref(
        "https://plan.example.org/path",
        vhostConfig,
        directPage,
      ),
    ).toBe("https://plan.example.org/path");
    expect(
      publicSessionLocalhostHref(
        "https://elsewhere.test/path",
        vhostConfig,
        directPage,
      ),
    ).toBeUndefined();
    const { vhostPublicRoot: _root, ...noRoot } = vhostConfig;
    expect(
      publicSessionLocalhostHref(
        "http://reports.localhost/today",
        noRoot,
        directPage,
      ),
    ).toBeUndefined();
  });
  it("rewrites generic subdomains but not private apps without an access decision", () => {
    const context = {
      clientUrl: "https://ya.example.org/-/relay/home/sessions/one",
      relayed: true,
    };
    expect(
      rewriteSessionLocalhostHref(
        "http://other.localhost/",
        { ...vhostConfig, accessTokens: { plan: "token" } },
        context,
      ),
    ).toBe("https://other.example.org/");
    expect(
      rewriteSessionLocalhostHref(
        "http://plan.localhost/",
        { ...vhostConfig, accessTokens: {} },
        context,
      ),
    ).toBe("http://plan.localhost/");
  });
  it("does not offer unreachable, same-host, mixed-content or unconfigured views", () => {
    for (const raw of [
      "http://localhost:3333",
      "https://share.plannotator.ai/foo",
      "http://evil.test:19432",
      "http://a@localhost:19432",
      "not a URL",
    ]) {
      expect(
        sessionVhostApp(raw, vhostConfig, "http://localhost:3400"),
      ).toBeUndefined();
    }
    const raw = "http://localhost:19432";
    expect(sessionVhostApp(raw, undefined, "http://localhost")).toBeUndefined();
    expect(
      sessionVhostApp(raw, { ...vhostConfig, vhosts: [] }, "http://localhost"),
    ).toBeUndefined();
    expect(
      sessionVhostApp(
        raw,
        { ...vhostConfig, vhostPublicRoot: undefined },
        "https://ya.example.net",
      ),
    ).toBeUndefined();
    expect(
      sessionVhostApp(raw, vhostConfig, "https://localhost"),
    ).toBeUndefined();
    expect(
      sessionVhostApp(raw, vhostConfig, "https://plan.example.org"),
    ).toBeUndefined();
  });
  it("reads only tool output, including nested text, and caches immutable messages", () => {
    const message = {
      content: [
        { type: "text", text: "http://localhost:19432/prose" },
        {
          type: "tool_use",
          input: { command: "http://localhost:19432/input" },
        },
        {
          type: "tool_result",
          content:
            "Open http://localhost:19432/review.\nhttp://localhost:19432.evil.test/",
        },
        {
          type: "tool_result",
          content: [{ type: "text", text: "http://[::1]:19432/next" }],
        },
      ],
    };
    expect(sessionToolUrls(message)).toEqual([
      "http://localhost:19432/review",
      "http://[::1]:19432/next",
    ]);
    expect(sessionToolUrls(message)).toBe(sessionToolUrls(message));
  });
  it("rejects source templates and their previously encoded links", () => {
    for (const raw of [
      // biome-ignore lint/suspicious/noTemplateCurlyInString: tool output can contain literal source placeholders.
      "http://localhost:19432/${path}",
      "http://localhost:19432/$%7Bpath%7D",
    ]) {
      expect(
        sessionToolUrls({ content: [{ type: "tool_result", content: raw }] }),
      ).toEqual([]);
      expect(
        sessionVhostApp(raw, vhostConfig, "http://localhost:3400"),
      ).toBeUndefined();
    }
  });
});
