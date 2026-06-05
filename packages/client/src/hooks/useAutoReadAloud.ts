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

/**
 * Auto-read-aloud: when enabled, reads the latest assistant message aloud as
 * soon as a turn finishes (process state transitions in-turn -> idle).
 *
 * The toggle is persisted per device in localStorage, so each device/tab
 * decides independently whether it speaks.
 *
 * @param processState current session process state
 * @param getLatestAssistantText returns the full plain text of the last
 *   assistant message (or null if none) — read lazily when a turn finishes
 */
export function useAutoReadAloud(
  processState: string,
  getLatestAssistantText: () => string | null,
): { enabled: boolean; toggle: () => void } {
  const [enabled, setEnabled] = useState(readStored);
  const prevProcessState = useRef(processState);
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
    if (!enabled) return;
    // A turn just completed.
    if (prev === "in-turn" && processState === "idle") {
      const text = getterRef.current();
      if (text?.trim()) {
        void playReadAloud(text, "auto");
      }
    }
  }, [processState, enabled]);

  return { enabled, toggle };
}
