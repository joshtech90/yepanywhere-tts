import { describe, expect, it } from "vitest";
import { shortCockpitModelLabel } from "./modelLabel";

describe("shortCockpitModelLabel", () => {
  it("drops the Claude prefix and a release date", () => {
    expect(shortCockpitModelLabel("claude-opus-5-5")).toBe("opus-5-5");
    expect(shortCockpitModelLabel("claude-haiku-4-5-20251001")).toBe(
      "haiku-4-5",
    );
  });

  it("keeps other names and never returns an empty label", () => {
    expect(shortCockpitModelLabel("gpt-5.6-sol")).toBe("gpt-5.6-sol");
    expect(shortCockpitModelLabel("claude-")).toBe("claude-");
    expect(shortCockpitModelLabel("Standard")).toBe("Standard");
  });
});
