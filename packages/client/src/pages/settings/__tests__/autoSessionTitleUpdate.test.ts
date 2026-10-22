import {
  type AutoSessionTitleSettings,
  DEFAULT_AUTO_SESSION_TITLE_SETTINGS,
} from "@yep-anywhere/shared";
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useAutoSessionTitleUpdate } from "../autoSessionTitleUpdate";

describe("useAutoSessionTitleUpdate", () => {
  it("keeps an unsaved change when the next control changes right after it", async () => {
    const stored = { ...DEFAULT_AUTO_SESSION_TITLE_SETTINGS, enabled: true };
    const pending: Array<() => void> = [];
    const save = vi.fn(
      (_next: AutoSessionTitleSettings) =>
        new Promise<void>((resolve) => pending.push(resolve)),
    );
    const { result } = renderHook(() =>
      useAutoSessionTitleUpdate(stored, save),
    );

    // Leaving the length field saves it; the tap on the checkbox follows
    // before the server has answered, so the stored value is still old.
    let first: Promise<void> | undefined;
    let second: Promise<void> | undefined;
    act(() => {
      first = result.current({ maxLength: 60 });
      second = result.current({ backfillExisting: true });
    });
    expect(save).toHaveBeenLastCalledWith({
      ...stored,
      maxLength: 60,
      backfillExisting: true,
    });

    await act(async () => {
      for (const resolve of pending) resolve();
      await Promise.all([first, second]);
    });
    act(() => {
      void result.current({ language: "de" });
    });
    expect(save).toHaveBeenLastCalledWith({ ...stored, language: "de" });
  });
});
