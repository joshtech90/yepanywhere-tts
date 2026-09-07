import { describe, expect, it } from "vitest";
import {
  getModelEffortLevels,
  nativeModelEffort,
  resolveTurnEffort,
} from "../src/turn-effort.js";
import type { ModelInfo } from "../src/types.js";

const model: ModelInfo = {
  id: "model",
  name: "Model",
  defaultReasoningEffort: "high",
  supportedReasoningEfforts: [
    "low",
    "medium",
    "high",
    "xhigh",
    "max",
    "ultra",
  ].map((reasoningEffort) => ({ reasoningEffort })),
};

describe("model-aware one-turn effort", () => {
  it("uses one UI Max for the highest native effort", () => {
    expect(getModelEffortLevels(model)).toEqual([
      "low",
      "medium",
      "high",
      "xhigh",
      "max",
    ]);
    expect(nativeModelEffort("max", model)).toBe("ultra");
    expect(nativeModelEffort("xhigh", model)).toBe("xhigh");
    expect(
      nativeModelEffort("max", {
        ...model,
        supportedReasoningEfforts: [{ reasoningEffort: "xhigh" }],
      }),
    ).toBe("xhigh");
  });
  it("steps through selectable levels and saturates", () => {
    expect(resolveTurnEffort("slow", "on:high", model)).toBe("on:xhigh");
    expect(resolveTurnEffort("fast", "on:max", model)).toBe("on:xhigh");
    expect(resolveTurnEffort("slow", "on:max", model)).toBe("on:max");
    expect(resolveTurnEffort("fast", "on:low", model)).toBe("on:low");
    expect(resolveTurnEffort("fast", "auto", model)).toBe("on:medium");
    expect(resolveTurnEffort("fastest", "on:max", model)).toBe("off");
    expect(resolveTurnEffort("slowest", "off", model)).toBe("on:max");
    expect(resolveTurnEffort("slow", "off", model)).toBe("on:low");
  });
  it("skips unsupported levels and rejects unknown defaults", () => {
    const sparse = {
      ...model,
      defaultReasoningEffort: undefined,
      supportedReasoningEfforts: [
        { reasoningEffort: "low" },
        { reasoningEffort: "high" },
      ],
    };
    expect(resolveTurnEffort("slow", "on:low", sparse)).toBe("on:high");
    expect(() => resolveTurnEffort("slow", "auto", sparse)).toThrow(
      "explicit supported effort",
    );
  });
});
