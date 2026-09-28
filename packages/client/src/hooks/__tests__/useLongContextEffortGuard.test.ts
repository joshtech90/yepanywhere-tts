import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useLongContextEffortGuard } from "../useLongContextEffortGuard";

describe("long-context effort confirmation", () => {
  it("updates the fork choice when session eligibility changes while open", async () => {
    const forkWithThinking = vi.fn().mockResolvedValue(undefined);
    const { result, rerender } = renderHook(
      ({ canFork }) =>
        useLongContextEffortGuard({
          provider: "claude",
          model: "opus",
          contextTokens: 123_456,
          settings: {
            providers: { claude: true },
            thresholdTokens: 5_000,
          },
          canFork,
          forkWithThinking,
          translateEffort: (key) => key,
          noEffortLabel: "None",
        }),
      { initialProps: { canFork: false } },
    );
    let decision: Promise<"apply" | "skip"> | undefined;
    act(() => {
      decision = result.current.guardEffortChange("on:max", "on:high");
    });
    expect(result.current.warning?.canFork).toBe(false);

    rerender({ canFork: true });
    expect(result.current.warning?.canFork).toBe(true);
    const displayedChoice = result.current.choose;
    rerender({ canFork: false });
    expect(result.current.warning?.canFork).toBe(false);
    await act(() => displayedChoice("fork"));
    expect(forkWithThinking).not.toHaveBeenCalled();
    expect(result.current.warning).not.toBeNull();

    rerender({ canFork: true });
    await act(() => result.current.choose("fork"));
    expect(forkWithThinking).toHaveBeenCalledTimes(1);
    expect(forkWithThinking).toHaveBeenCalledWith("on:max");
    await expect(decision).resolves.toBe("skip");
    expect(result.current.warning).toBeNull();
  });

  it("offers no fork when the same change also switches the model", async () => {
    const forkWithThinking = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() =>
      useLongContextEffortGuard({
        provider: "claude",
        model: "opus",
        contextTokens: 123_456,
        settings: {
          providers: { claude: true },
          thresholdTokens: 5_000,
        },
        canFork: true,
        forkWithThinking,
        translateEffort: (key) => key,
        noEffortLabel: "None",
      }),
    );
    let decision: Promise<"apply" | "skip"> | undefined;
    act(() => {
      decision = result.current.guardEffortChange("on:max", "on:high", {
        changesModel: true,
      });
    });
    expect(result.current.warning?.canFork).toBe(false);

    await act(() => result.current.choose("fork"));
    expect(forkWithThinking).not.toHaveBeenCalled();
    expect(result.current.warning).not.toBeNull();

    await act(() => result.current.choose("apply"));
    await expect(decision).resolves.toBe("apply");
  });
});
