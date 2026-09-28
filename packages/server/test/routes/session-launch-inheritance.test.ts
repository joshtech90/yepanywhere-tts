import { describe, expect, it, vi } from "vitest";
import type { EffectiveSessionLaunchSettings } from "../../src/metadata/index.js";
import { inheritSuccessorLaunchSettings } from "../../src/routes/session-launch-inheritance.js";

const source: EffectiveSessionLaunchSettings = {
  schemaVersion: 1,
  revision: 2,
  permissionMode: "plan",
  requestedModel: "opus",
  serviceTier: "priority",
  thinking: { type: "adaptive", display: "summarized" },
  effort: "low",
};

describe("inheritSuccessorLaunchSettings", () => {
  it("inherits every source setting when nothing is overridden", () => {
    expect(
      inheritSuccessorLaunchSettings(source, { sameProvider: true }, {}),
    ).toEqual({
      requestedModel: "opus",
      thinking: { type: "adaptive", display: "summarized" },
      effort: "low",
      serviceTier: "priority",
      permissionMode: "plan",
    });
  });

  it("lets each explicit override win, including a cleared service tier", () => {
    expect(
      inheritSuccessorLaunchSettings(
        source,
        { sameProvider: true },
        {
          requestedModel: "sonnet",
          thinking: "off",
          serviceTier: null,
          permissionMode: "acceptEdits",
        },
      ),
    ).toEqual({
      requestedModel: "sonnet",
      thinking: { type: "disabled" },
      effort: undefined,
      serviceTier: undefined,
      permissionMode: "acceptEdits",
    });
  });

  it("keeps only the permission mode across a provider change", () => {
    const legacyRequestedModel = vi.fn(() => "haiku");
    expect(
      inheritSuccessorLaunchSettings(
        source,
        { sameProvider: false, legacyRequestedModel },
        {},
      ),
    ).toEqual({
      requestedModel: undefined,
      thinking: undefined,
      effort: undefined,
      serviceTier: undefined,
      permissionMode: "plan",
    });
    expect(legacyRequestedModel).not.toHaveBeenCalled();
  });

  it("reads the legacy requested model only when nothing else names one", () => {
    const legacyRequestedModel = vi.fn(() => "haiku");
    expect(
      inheritSuccessorLaunchSettings(
        { ...source, requestedModel: null },
        { sameProvider: true, legacyRequestedModel },
        {},
      ).requestedModel,
    ).toBe("haiku");
    inheritSuccessorLaunchSettings(
      source,
      { sameProvider: true, legacyRequestedModel },
      {},
    );
    expect(legacyRequestedModel).toHaveBeenCalledTimes(1);
  });
});
