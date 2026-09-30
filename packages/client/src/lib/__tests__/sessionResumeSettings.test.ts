import { describe, expect, it } from "vitest";
import {
  sessionResumeOverrides,
  stoppedSessionPermissionMode,
} from "../sessionResumeSettings";

describe("session resume settings", () => {
  const staleBrowser = {
    mode: "default",
    model: "old-model",
    thinking: "off",
  } as const;

  it("does not override restored settings with fresh-browser or stale display values", () => {
    expect(sessionResumeOverrides(true, staleBrowser, {})).toEqual({});
    expect(
      stoppedSessionPermissionMode("default", undefined, "bypassPermissions"),
    ).toBe("bypassPermissions");
  });

  it("preserves deliberate Ask and Off even when they match browser defaults", () => {
    const explicit = { mode: "default", thinking: "off" } as const;
    expect(sessionResumeOverrides(true, staleBrowser, explicit)).toEqual(
      explicit,
    );
    expect(
      stoppedSessionPermissionMode("default", "default", "bypassPermissions"),
    ).toBe("default");
  });

  it("sends only the explicitly changed setting", () => {
    expect(
      sessionResumeOverrides(true, staleBrowser, { thinking: "on:low" }),
    ).toEqual({ thinking: "on:low" });
    expect(
      sessionResumeOverrides(true, staleBrowser, { mode: "plan" }),
    ).toEqual({ mode: "plan" });
  });

  it("retains existing request fields and fallback behavior on older servers", () => {
    expect(sessionResumeOverrides(false, staleBrowser, {})).toEqual(
      staleBrowser,
    );
    expect(
      sessionResumeOverrides(false, staleBrowser, {
        mode: undefined,
        thinking: undefined,
      }),
    ).toEqual(staleBrowser);
    expect(
      sessionResumeOverrides(false, staleBrowser, { thinking: "auto" }),
    ).toEqual({ ...staleBrowser, thinking: "auto" });
    expect(stoppedSessionPermissionMode("plan", undefined, undefined)).toBe(
      "plan",
    );
  });
});
