import { describe, expect, it } from "vitest";
import type { ArtifactViewerStatus } from "@yep-anywhere/shared";
import { sessionToolUrls, sessionVhostApp } from "./sessionVhostApps";

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
