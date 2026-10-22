import { useCallback, useEffect, useRef, useState } from "react";
import { playReadAloud, stopReadAloud } from "../lib/readAloud";

const STORAGE_KEY = "yep-tts-autoread";

function readStored(): boolean {
  try {
    return (
      typeof localStorage !== "undefined" &&
      localStorage.getItem(STORAGE_KEY) === "1"
    );
  } catch {
    return false;
  }
}

/** The newest assistant text of a session and a stable key for it. */
export interface LatestAssistantText {
  key: string;
  text: string;
}

function isBusy(processState: string): boolean {
  return processState === "in-turn" || processState === "waiting-input";
}

/**
 * Auto-read-aloud: when enabled, reads the latest assistant message aloud as
 * soon as a turn finishes (process state transitions in-turn -> idle).
 *
 * The toggle is persisted per device in localStorage, so each device/tab
 * decides independently whether it speaks.
 *
 * @param processState current session process state
 * @param getLatestAssistantText returns the last assistant message with text
 *   (or null if none) — read lazily when a turn starts and finishes
 */
export function useAutoReadAloud(
  processState: string,
  getLatestAssistantText: () => LatestAssistantText | null,
): { enabled: boolean; toggle: () => void } {
  const [enabled, setEnabled] = useState(readStored);
  const prevProcessState = useRef(processState);
  // Newest assistant text when the turn began; undefined = no turn seen.
  const turnBaseline = useRef<string | null | undefined>(undefined);
  // Keep the latest getter without forcing the effect to re-run on every render.
  const getterRef = useRef(getLatestAssistantText);
  getterRef.current = getLatestAssistantText;

  const toggle = useCallback(() => {
    setEnabled((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(STORAGE_KEY, next ? "1" : "0");
      } catch {
        // ignore storage failures (private mode etc.)
      }
      if (!next) stopReadAloud();
      return next;
    });
  }, []);

  useEffect(() => {
    const prev = prevProcessState.current;
    prevProcessState.current = processState;
    if (isBusy(processState)) {
      if (!isBusy(prev) || turnBaseline.current === undefined) {
        turnBaseline.current = getterRef.current()?.key ?? null;
      }
      return;
    }
    // A turn just completed.
    if (prev === "in-turn" && processState === "idle") {
      const baseline = turnBaseline.current;
      turnBaseline.current = undefined;
      if (!enabled) return;
      const latest = getterRef.current();
      // A turn that wrote no new text (stopped early, only tools, a command
      // such as /compact) must not repeat the previous answer.
      if (latest?.text.trim() && latest.key !== baseline) {
        void playReadAloud(latest.text, "auto");
      }
    }
  }, [processState, enabled]);

  return { enabled, toggle };
}
