import { useCallback, useEffect, useRef, type MutableRefObject } from "react";
import type { VoiceInputButtonRef } from "../components/VoiceInputButton";

/** A second control invokes the exact capture transaction owned by the composer. */
export function useComposerVoiceRef(
  owner: MutableRefObject<VoiceInputButtonRef | null>,
  publish?: (control: VoiceInputButtonRef | null) => void,
) {
  const published = useRef<VoiceInputButtonRef | null>(null);
  useEffect(
    () => () => {
      published.current = null;
      publish?.(null);
    },
    [publish],
  );
  return useCallback(
    (control: VoiceInputButtonRef | null) => {
      owner.current = control;
      if (!control) {
        queueMicrotask(() => {
          if (!owner.current) {
            published.current = null;
            publish?.(null);
          }
        });
        return;
      }
      // useImperativeHandle detaches/reattaches whenever its callbacks change.
      // Publish observable capture state, not every new callback identity; the
      // stable delegates always read the composer's current controller.
      if (
        !publish ||
        (published.current?.isListening === control.isListening &&
          published.current?.isAvailable === control.isAvailable)
      )
        return;
      const snapshot: VoiceInputButtonRef = {
        isListening: control.isListening,
        isAvailable: control.isAvailable,
        toggle: () => owner.current?.toggle(),
        prewarm: () => owner.current?.prewarm(),
        stopAndFinalize: () => owner.current?.stopAndFinalize() ?? "",
        cancelProcessing: () => owner.current?.cancelProcessing(),
        beginInsertionBoundary: () => owner.current?.beginInsertionBoundary(),
        continueAfterSpeechSend: () => owner.current?.continueAfterSpeechSend(),
      };
      published.current = snapshot;
      publish(snapshot);
    },
    [owner, publish],
  );
}
