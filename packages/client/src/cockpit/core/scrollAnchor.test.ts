import { describe, expect, it } from "vitest";
import { countEntriesBeforeCockpitScrollAnchor } from "./scrollAnchor";

const entries = (...keys: string[]) => keys.map((key) => ({ key }));

describe("Cockpit transcript scroll anchor", () => {
  it("distinguishes a live append from older history inserted above", () => {
    expect(
      countEntriesBeforeCockpitScrollAnchor(
        "visible-first",
        entries("visible-first", "visible-last", "live-tail"),
      ),
    ).toBe(0);
    expect(
      countEntriesBeforeCockpitScrollAnchor(
        "visible-first",
        entries(
          "older-one",
          "older-two",
          "visible-first",
          "visible-last",
          "live-tail",
        ),
      ),
    ).toBe(2);
  });

  it("refuses to correct a transcript that no longer contains the anchor", () => {
    expect(
      countEntriesBeforeCockpitScrollAnchor(
        "old-session-row",
        entries("new-session-row"),
      ),
    ).toBeNull();
  });
});
