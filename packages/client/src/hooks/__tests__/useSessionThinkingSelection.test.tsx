import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useSessionThinkingSelection } from "../useSessionThinkingSelection";

describe("stopped-session thinking", () => {
  const config = { thinking: { type: "adaptive" }, effort: "high" };

  it("shows retained thinking before resume without creating an override", () => {
    const { result } = renderHook(() =>
      useSessionThinkingSelection("source/session", false, config),
    );
    expect(result.current.selection).toEqual({
      mode: "on",
      effortLevel: "high",
    });
    expect(result.current.thinkingOverride).toBeUndefined();
  });

  it("keeps an explicit Off selection through metadata refresh, then adopts the resumed process", () => {
    const { result, rerender } = renderHook(
      ({ owned, effort }) =>
        useSessionThinkingSelection("source/session", owned, {
          ...config,
          effort,
        }),
      { initialProps: { owned: false, effort: "high" } },
    );
    act(() =>
      result.current.setStoppedSelection({ mode: "off", effortLevel: "high" }),
    );
    rerender({ owned: false, effort: "low" });
    expect(result.current.selection?.mode).toBe("off");
    expect(result.current.thinkingOverride).toBe("off");
    rerender({ owned: true, effort: "medium" });
    expect(result.current.selection?.effortLevel).toBe("medium");
    expect(result.current.thinkingOverride).toBeUndefined();
  });

  it("does not carry unsent choices across sessions or sources", () => {
    const { result, rerender } = renderHook(
      ({ key }) => useSessionThinkingSelection(key, false, config),
      { initialProps: { key: "source-a/session" } },
    );
    act(() =>
      result.current.setStoppedSelection({ mode: "on", effortLevel: "low" }),
    );
    expect(result.current.thinkingOverride).toBe("on:low");
    rerender({ key: "source-b/session" });
    expect(result.current.selection?.effortLevel).toBe("high");
    expect(result.current.thinkingOverride).toBeUndefined();
    rerender({ key: "source-a/session" });
    expect(result.current.thinkingOverride).toBeUndefined();
  });

  it("keeps the legacy toolbar fallback when no session config is known", () => {
    const { result } = renderHook(() =>
      useSessionThinkingSelection("source/session", false, null),
    );
    expect(result.current.selection).toBeNull();
    expect(result.current.thinkingOverride).toBeUndefined();
  });
});
