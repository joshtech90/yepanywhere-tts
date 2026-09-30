import { act, renderHook } from "@testing-library/react";
import { useRef } from "react";
import { expect, it, vi } from "vitest";
import type { VoiceInputButtonRef } from "../../components/VoiceInputButton";
import { useComposerVoiceRef } from "../useComposerVoiceRef";

it("retains one control across imperative-handle replacement and delegates to the current composer", async () => {
  const publish = vi.fn();
  const { result, unmount } = renderHook(() => {
    const owner = useRef<VoiceInputButtonRef | null>(null);
    return useComposerVoiceRef(owner, publish);
  });
  const first: VoiceInputButtonRef = {
    isAvailable: true,
    isListening: false,
    toggle: vi.fn(),
    prewarm: vi.fn(),
    stopAndFinalize: () => "first",
    cancelProcessing: vi.fn(),
    beginInsertionBoundary: vi.fn(),
    continueAfterSpeechSend: vi.fn(),
  };
  act(() => result.current(first));
  const shared = publish.mock.calls[0]![0] as VoiceInputButtonRef;
  const next = { ...first, toggle: vi.fn(), stopAndFinalize: () => "next" };
  await act(async () => {
    result.current(null);
    result.current(next);
  });
  expect(publish).toHaveBeenCalledTimes(1);
  shared.toggle();
  expect(next.toggle).toHaveBeenCalledOnce();
  expect(first.toggle).not.toHaveBeenCalled();
  expect(shared.stopAndFinalize()).toBe("next");
  act(() => result.current({ ...next, isListening: true }));
  expect(publish).toHaveBeenLastCalledWith(
    expect.objectContaining({ isListening: true }),
  );
  unmount();
  expect(publish).toHaveBeenLastCalledWith(null);
});
