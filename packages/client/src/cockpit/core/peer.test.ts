import { describe, expect, it } from "vitest";
import { parseCockpitPeer } from "./peer";

describe("parseCockpitPeer", () => {
  it("reads a peer and takes its icon from the other machine", () => {
    expect(
      parseCockpitPeer({
        label: " aihub ",
        url: "https://aihub.example.ts.net:3400/cockpit",
      }),
    ).toEqual({
      label: "aihub",
      url: "https://aihub.example.ts.net:3400/cockpit",
      icon: "https://aihub.example.ts.net:3400/icon-192.png",
    });
  });

  it("resolves a configured icon against the peer address", () => {
    expect(
      parseCockpitPeer({
        label: "Mac",
        url: "https://mac.example.ts.net:3400/cockpit",
        icon: "/favicon.ico?v=1",
      })?.icon,
    ).toBe("https://mac.example.ts.net:3400/favicon.ico?v=1");
  });

  it("means no peer for missing, malformed or non-web entries", () => {
    for (const raw of [
      null,
      "<!doctype html>",
      {},
      { label: "", url: "https://a.example/" },
      { label: "x".repeat(25), url: "https://a.example/" },
      { label: "aihub" },
      { label: "aihub", url: "cockpit" },
      { label: "aihub", url: "javascript:alert(1)" },
      { label: "aihub", url: "https://a.example/", icon: "data:image/png," },
    ]) {
      expect(parseCockpitPeer(raw)).toBeNull();
    }
  });

  it("offers no switch to the Cockpit already on screen", () => {
    expect(
      parseCockpitPeer(
        { label: "Mac", url: "https://mac.example:3400/cockpit" },
        "https://mac.example:3400",
      ),
    ).toBeNull();
  });
});
