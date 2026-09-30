import { describe, expect, it } from "vitest";
import { parseCockpitPeer } from "./peer";

describe("parseCockpitPeer", () => {
  it("reads a peer; without an icon the button draws its own", () => {
    expect(
      parseCockpitPeer({
        label: " aihub ",
        url: "https://aihub.example.ts.net:3400/cockpit",
      }),
    ).toEqual({
      label: "aihub",
      url: "https://aihub.example.ts.net:3400/cockpit",
      icon: null,
    });
  });

  it("keeps only an icon served by this Cockpit itself", () => {
    const peer = (icon: string) =>
      parseCockpitPeer({
        label: "Mac",
        url: "https://mac.example.ts.net:3400/cockpit",
        icon,
      })?.icon;
    expect(peer("/cockpit-peer-icon.png?v=1")).toBe(
      "/cockpit-peer-icon.png?v=1",
    );
    // The content policy would block these, leaving a broken image.
    expect(peer("https://mac.example.ts.net:3400/icon-192.png")).toBeNull();
    expect(peer("//mac.example.ts.net/icon-192.png")).toBeNull();
    expect(peer("data:image/png,")).toBeNull();
    expect(peer("/\\mac.example.ts.net/icon-192.png")).toBeNull();
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
