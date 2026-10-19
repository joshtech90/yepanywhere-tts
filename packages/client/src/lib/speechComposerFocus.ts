import { hasCoarsePointer } from "./deviceDetection";
import { programmaticFocus } from "./programmaticFocus";

/**
 * Keep speech as an independent input path on touch-first devices, where
 * focusing the composer would summon the on-screen keyboard. Fine-pointer and
 * keyboard workflows retain their ready-to-type focus behavior. Speech
 * transitions arrive from voice events, so an embedded app keeps its focus.
 */
export function focusComposerForSpeechTransition(
  textarea: HTMLTextAreaElement | null,
): void {
  if (!hasCoarsePointer()) programmaticFocus(textarea);
}
