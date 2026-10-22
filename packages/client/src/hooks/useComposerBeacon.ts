import { useCallback, useEffect, useRef } from "react";
import {
  appendComposerBeacon,
  COMPOSER_BEACON_ATTRIBUTE,
} from "../lib/composerBeacon";
import type { DraftControls } from "./useDraftPersistence";
import { useComposerBeaconPreference } from "./useComposerBeaconPreference";
import type { PendingMessage } from "./useSession";
import type { Message } from "../types";

type DeliveryState = "idle" | "sending" | "queued" | "delivered" | "error";
const GLYPHS: Record<DeliveryState, string> = {
  idle: "",
  sending: "↥ ",
  queued: "◷ ",
  delivered: "✓ ",
  error: "! ",
};

interface BeaconState {
  focusedAt: number;
  windowFocused: boolean;
  ready: number;
  accepted: number;
  delivery: DeliveryState;
  submission: PendingMessage | null;
  publish(): void;
}

/** Expose session composer focus and accepted sends to an OS hotkey helper. */
export function useComposerBeacon({
  sessionKey,
  active,
  controlsRef,
  messages,
  isMessageDelivered,
}: {
  sessionKey: string;
  active: boolean;
  controlsRef: { current: Pick<DraftControls, "focus" | "isFocused"> | null };
  messages: Message[];
  isMessageDelivered: (message: PendingMessage) => boolean;
}) {
  const { composerBeaconEnabled } = useComposerBeaconPreference();
  const stateRef = useRef<BeaconState | null>(null);

  useEffect(() => {
    void sessionKey;
    if (!active || !composerBeaconEnabled) return;
    const title = document.querySelector("title");
    if (!title) return;
    const state: BeaconState = {
      focusedAt: 0,
      windowFocused:
        document.hasFocus() && document.visibilityState === "visible",
      ready: 0,
      accepted: 0,
      delivery: "idle",
      submission: null,
      publish() {
        title.setAttribute(
          COMPOSER_BEACON_ATTRIBUTE,
          `${GLYPHS[state.delivery]}[YA1 f=${state.focusedAt} r=${state.ready} a=${state.accepted} s=${state.delivery}] w=${state.windowFocused ? 1 : 0}`,
        );
        document.title = appendComposerBeacon(document.title);
      },
    };
    stateRef.current = state;
    const recordFocus = () => {
      state.windowFocused =
        document.visibilityState === "visible" && document.hasFocus();
      if (state.windowFocused && controlsRef.current?.isFocused?.())
        state.focusedAt = Math.max(Date.now(), state.focusedAt + 1);
      state.publish();
    };
    const disarm = () => {
      state.ready = 0;
      state.accepted = 0;
      state.publish();
    };
    const onBlur = () => {
      state.windowFocused = false;
      disarm();
    };
    const onVisibility = () => {
      if (document.visibilityState === "hidden") onBlur();
      else recordFocus();
    };
    const onKey = (event: KeyboardEvent) => {
      if (
        event.code !== "F8" ||
        !event.ctrlKey ||
        !event.altKey ||
        !event.shiftKey ||
        event.metaKey ||
        event.repeat ||
        !document.hasFocus() ||
        document.visibilityState !== "visible"
      )
        return;
      event.preventDefault();
      event.stopImmediatePropagation();
      state.windowFocused = true;
      disarm();
      controlsRef.current?.focus?.({ preventScroll: true });
      if (!controlsRef.current?.isFocused?.()) return;
      state.focusedAt = Math.max(Date.now(), state.focusedAt + 1);
      state.ready = state.focusedAt;
      state.publish();
    };
    state.publish();
    recordFocus();
    document.addEventListener("focusin", recordFocus);
    window.addEventListener("focus", recordFocus);
    window.addEventListener("blur", onBlur);
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("focusin", recordFocus);
      window.removeEventListener("focus", recordFocus);
      window.removeEventListener("blur", onBlur);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("keydown", onKey, true);
      stateRef.current = null;
      title.removeAttribute(COMPOSER_BEACON_ATTRIBUTE);
      document.title = appendComposerBeacon(document.title);
    };
  }, [active, composerBeaconEnabled, controlsRef, sessionKey]);

  useEffect(() => {
    // Transcript echoes prove release; disappearing queue rows alone do not.
    void messages;
    const state = stateRef.current;
    if (!state?.submission || state.delivery !== "queued") return;
    if (isMessageDelivered(state.submission)) {
      state.delivery = "delivered";
      state.publish();
    }
  }, [messages, isMessageDelivered]);

  // Capture before awaiting delivery: an older send must not complete a new arm.
  return useCallback(
    (submission: PendingMessage) => {
      const state = stateRef.current;
      const request = state?.ready;
      if (state) {
        state.submission = submission;
        state.delivery = "sending";
        state.publish();
      }
      return (delivery: "queued" | "delivered" | "error") => {
        if (
          !state ||
          stateRef.current !== state ||
          state.submission !== submission
        )
          return;
        state.delivery =
          delivery === "queued" && isMessageDelivered(submission)
            ? "delivered"
            : delivery;
        if (delivery !== "error" && request && state.ready === request)
          state.accepted = request;
        state.publish();
      };
    },
    [isMessageDelivered],
  );
}
