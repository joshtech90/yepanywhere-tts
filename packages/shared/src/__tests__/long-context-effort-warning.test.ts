import { describe, expect, it } from "vitest";
import {
  DEFAULT_LONG_CONTEXT_EFFORT_WARNING_TOKENS,
  effortOfThinkingOption,
  parseLongContextEffortWarningSettings,
  shouldWarnLongContextEffortChange,
} from "../long-context-effort-warning.js";

const enabled = {
  providers: { claude: true, codex: true },
  thresholdTokens: 5000,
};

describe("parseLongContextEffortWarningSettings", () => {
  it("defaults to Claude and Codex at the default threshold", () => {
    expect(parseLongContextEffortWarningSettings(undefined)).toEqual({
      providers: { claude: true, codex: true },
      thresholdTokens: DEFAULT_LONG_CONTEXT_EFFORT_WARNING_TOKENS,
    });
  });

  it("keeps only checked known providers and a non-negative integer threshold", () => {
    expect(
      parseLongContextEffortWarningSettings({
        providers: { claude: false, pi: true },
        thresholdTokens: 0,
      }),
    ).toEqual({ providers: { pi: true }, thresholdTokens: 0 });
    expect(
      parseLongContextEffortWarningSettings({ providers: { nope: true } }),
    ).toBeNull();
    expect(
      parseLongContextEffortWarningSettings({ thresholdTokens: -1 }),
    ).toBeNull();
    expect(
      parseLongContextEffortWarningSettings({ thresholdTokens: 12.5 }),
    ).toBeNull();
    expect(
      parseLongContextEffortWarningSettings({ thresholdTokens: 750_000 }),
    ).toEqual({ providers: {}, thresholdTokens: 750_000 });
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

describe("shouldWarnLongContextEffortChange", () => {
  const base = {
    provider: "claude" as const,
    model: "opus",
    contextTokens: 120_000,
    currentThinking: "on:high" as const,
    nextThinking: "on:max" as const,
    settings: enabled,
  };

  it("warns for an enabled provider at or above the threshold", () => {
    expect(shouldWarnLongContextEffortChange(base)).toBe(true);
    expect(
      shouldWarnLongContextEffortChange({ ...base, contextTokens: 5000 }),
    ).toBe(true);
  });

  it("stays quiet below the threshold or with no known prompt size", () => {
    expect(
      shouldWarnLongContextEffortChange({ ...base, contextTokens: 4999 }),
    ).toBe(false);
    expect(
      shouldWarnLongContextEffortChange({ ...base, contextTokens: undefined }),
    ).toBe(false);
  });

  it("stays quiet when the effort component does not change", () => {
    expect(
      shouldWarnLongContextEffortChange({ ...base, nextThinking: "on:high" }),
    ).toBe(false);
    expect(
      shouldWarnLongContextEffortChange({
        ...base,
        currentThinking: "auto",
        nextThinking: "off",
      }),
    ).toBe(false);
  });

  it("counts auto or off to an explicit effort as a change", () => {
    expect(
      shouldWarnLongContextEffortChange({ ...base, currentThinking: "auto" }),
    ).toBe(true);
    expect(
      shouldWarnLongContextEffortChange({ ...base, nextThinking: "off" }),
    ).toBe(true);
  });

  it("respects the per-provider checkboxes and a missing setting", () => {
    expect(shouldWarnLongContextEffortChange({ ...base, provider: "pi" })).toBe(
      false,
    );
    expect(
      shouldWarnLongContextEffortChange({ ...base, settings: undefined }),
    ).toBe(false);
    expect(
      shouldWarnLongContextEffortChange({
        ...base,
        settings: { providers: {}, thresholdTokens: 0 },
      }),
    ).toBe(false);
  });

  it("warns on Codex Astra until its in-place effort update is usable", () => {
    expect(
      shouldWarnLongContextEffortChange({
        ...base,
        provider: "codex",
        model: "gpt-6-astra",
      }),
    ).toBe(true);
  });
});
