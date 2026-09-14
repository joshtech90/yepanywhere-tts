import { describe, expect, it } from "vitest";
import { isArtifactLink } from "./artifactPreview";

const config = {
  port: 4402,
  available: true,
  locked: false,
  defaultLocalOrigin: "http://artifacts.localhost:3400",
  localOrigin: "http://artifacts.localhost:3400",
  publicOrigin: "https://artifacts.example.org",
};

describe("artifact link routing", () => {
  it("accepts configured grant links without issuing requests", () => {
    expect(
      isArtifactLink(
        "https://artifacts.example.org/a/token/index.html",
        config,
        "http://localhost:3400",
      ),
    ).toBe(true);
    expect(
      isArtifactLink(
        "http://artifacts.localhost:3400/a/token/index.html#section",
        config,
        "http://localhost:3400",
      ),
    ).toBe(true);
  });

  it.each([
    "https://other.example.org/a/token/index.html",
    "https://artifacts.example.org/health",
    "https://artifacts.example.org/a/token/",
    "https://user@artifacts.example.org/a/token/index.html",
    "http://artifacts.example.org/a/token/index.html",
    "javascript:alert(1)",
    "http://[",
  ])("leaves unrelated or unsafe URLs to the normal link path: %s", (url) => {
    expect(isArtifactLink(url, config, "https://ya.example.org")).toBe(false);
  });

  it("does not embed unconfigured, same-hostname, or mixed-content URLs", () => {
    expect(
      isArtifactLink(
        "https://artifacts.example.org/a/token/index.html",
        undefined,
        "https://ya.example.org",
      ),
    ).toBe(false);
    expect(
      isArtifactLink(
        "http://artifacts.localhost:3400/a/token/index.html",
        config,
        "https://ya.example.org",
      ),
    ).toBe(false);
    expect(
      isArtifactLink(
        "https://artifacts.example.org/a/token/index.html",
        config,
        "https://artifacts.example.org:1234",
      ),
    ).toBe(false);
  });
});
