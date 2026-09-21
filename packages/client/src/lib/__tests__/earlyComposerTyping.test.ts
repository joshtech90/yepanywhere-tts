// @vitest-environment jsdom

import { describe, expect, it } from "vitest";
import type { DraftControls } from "../../hooks/useDraftPersistence";
import { applyEarlyComposerTyping } from "../earlyComposerTyping";
import { startEarlyTypingHandoff } from "../earlyTypingHandoff";

/** A composer whose draft, focus and caret the test can read back. */
function composer() {
  const state = {
    draft: "",
    focused: false,
    caret: [0, 0] as [number, number],
  };
  const controls = {
    getDraft: () => state.draft,
    setDraft: (value: string) => {
      state.draft = value;
    },
    focus: () => {
      state.focused = true;
    },
    isFocused: () => state.focused,
    setSelectionRange: (start: number, end: number) => {
      state.caret = [start, end];
    },
  } as unknown as DraftControls;
  return { controls, state };
}

function press(key: string): boolean {
  return window.dispatchEvent(
    new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }),
  );
}

describe("applyEarlyComposerTyping", () => {
  it("puts keys typed during the load after the prefilled text", () => {
    const handoff = startEarlyTypingHandoff();
    press("h");
    press("i");
    const { controls, state } = composer();

    applyEarlyComposerTyping({ controls, handoff, prefill: "!!git status" });

    expect(state.draft).toBe("!!git statushi");
    expect(state.focused).toBe(true);
    expect(state.caret).toEqual([
      "!!git statushi".length,
      "!!git statushi".length,
    ]);
  });

  it("keeps taking keys until the composer shows the whole draft", () => {
    const handoff = startEarlyTypingHandoff();
    const { controls, state } = composer();
    applyEarlyComposerTyping({ controls, handoff, prefill: "seed" });
    // Focused and in agreement, so the composer owns what follows.
    expect(handoff.active()).toBe(false);
    expect(press("x")).toBe(true);
    expect(state.draft).toBe("seed");
  });

  it("focuses without disturbing the draft when there is no prefill", () => {
    const handoff = startEarlyTypingHandoff();
    press("z");
    const { controls, state } = composer();
    state.draft = "already drafted";

    applyEarlyComposerTyping({ controls, handoff, prefill: null });

    expect(state.draft).toBe("already draftedz");
    expect(state.caret).toEqual([
      "already draftedz".length,
      "already draftedz".length,
    ]);
  });

  it("applies a prefill with no handoff at all", () => {
    const { controls, state } = composer();
    applyEarlyComposerTyping({ controls, handoff: null, prefill: "!!ls" });
    expect(state.draft).toBe("!!ls");
    expect(state.caret).toEqual(["!!ls".length, "!!ls".length]);
  });
});
