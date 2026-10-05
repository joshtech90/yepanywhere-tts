import type { KeyboardEvent } from "react";
import { settleModifier } from "./modifierChords";

interface VoiceShortcutEvent {
  key: string;
  code?: string;
  ctrlKey: boolean;
  metaKey?: boolean;
  altKey?: boolean;
  shiftKey?: boolean;
}

export function isVoiceInputShortcut(event: VoiceShortcutEvent): boolean {
  return (
    event.ctrlKey &&
    !event.metaKey &&
    !event.altKey &&
    !event.shiftKey &&
    (event.code === "Space" || event.key === " " || event.key === "Spacebar")
  );
}

/**
 * Handles a composer keydown as the Ctrl+Space voice toggle. A Space whose
 * Ctrl is still down from a just-finished chord (fast "Ctrl+V, Space") is
 * typed as the space it was meant to be instead; see modifierChords for the
 * timing rule. Returns whether the event was consumed.
 */
export function handleVoiceInputShortcutKeyDown(
  event: KeyboardEvent<Element>,
  toggle: () => void,
): boolean {
  if (!isVoiceInputShortcut(event)) return false;
  event.preventDefault();
  event.stopPropagation();
  if (event.repeat) return true;
  const target = event.target;
  settleModifier(event.nativeEvent, "ctrlKey", (applies) => {
    if (applies) toggle();
    else typeRolledOverSpace(target);
  });
  return true;
}

function typeRolledOverSpace(target: EventTarget): void {
  if (
    !(target instanceof HTMLTextAreaElement) ||
    document.activeElement !== target
  )
    return;
  // execCommand keeps the native undo stack; the fallback must announce the
  // edit itself so controlled React state sees it.
  try {
    if (document.execCommand?.("insertText", false, " ")) return;
  } catch {
    // Fall back to a direct textarea edit below.
  }
  target.setRangeText(" ", target.selectionStart, target.selectionEnd, "end");
  target.dispatchEvent(new Event("input", { bubbles: true }));
}
