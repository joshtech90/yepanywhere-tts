import { describe, expect, it } from "vitest";
import { effortOfThinkingOption, isThinkingOption } from "../turn-effort.js";

describe("isThinkingOption", () => {
  it("accepts every wire thinking option", () => {
    for (const option of [
      "off",
      "auto",
      "low",
      "medium",
      "high",
      "xhigh",
      "max",
      "on:low",
      "on:medium",
      "on:high",
      "on:xhigh",
      "on:max",
    ]) {
      expect(isThinkingOption(option)).toBe(true);
    }
  });

  it("rejects other values", () => {
    for (const value of [
      "on",
      "on:",
      "on:auto",
      "on:ultra",
      "ultra",
      "HIGH",
      "",
      undefined,
      null,
      3,
      { thinking: "high" },
    ]) {
      expect(isThinkingOption(value)).toBe(false);
    }
  });
});

describe("effortOfThinkingOption", () => {
  it("reads the effort component and treats auto/off as none", () => {
    expect(effortOfThinkingOption("on:high")).toBe("high");
    expect(effortOfThinkingOption("max")).toBe("max");
    expect(effortOfThinkingOption("auto")).toBeUndefined();
    expect(effortOfThinkingOption("off")).toBeUndefined();
    expect(effortOfThinkingOption(undefined)).toBeUndefined();
  });
});
