import type { DraftControls } from "../hooks/useDraftPersistence";
import type { EarlyTypingHandoff } from "./earlyTypingHandoff";

/**
 * Hand a composer the prefill a navigation asked for, then whatever was typed
 * while that composer was still loading.
 *
 * The keys follow the prefilled text — where the request meant them to go —
 * and the caret ends up after them, so typing simply continues.
 */
export function applyEarlyComposerTyping({
  controls,
  handoff,
  prefill,
}: {
  controls: DraftControls;
  /** The handoff holding keys struck before the composer existed. */
  handoff: EarlyTypingHandoff | null;
  /** Text to seed, or null to keep the existing draft and only focus. */
  prefill: string | null;
}): void {
  const seeded = prefill ?? controls.getDraft();
  if (prefill !== null) controls.setDraft(prefill);
  controls.focus?.();
  controls.setSelectionRange?.(seeded.length, seeded.length);
  if (!handoff) return;
  let expected = seeded;
  handoff.claim({
    // The draft value is what the textarea renders, and it is updated before
    // the next key can arrive, so it stands for what the field shows.
    hasFocus: () => controls.isFocused?.() ?? false,
    shows: () => controls.getDraft(),
    expects: () => expected,
    applyKey: (key) => {
      expected =
        "backspace" in key ? expected.slice(0, -1) : expected + key.insert;
      controls.setDraft(expected);
      controls.setSelectionRange?.(expected.length, expected.length);
    },
    repairCaret: () => {
      const length = controls.getDraft().length;
      controls.setSelectionRange?.(length, length);
    },
  });
}
