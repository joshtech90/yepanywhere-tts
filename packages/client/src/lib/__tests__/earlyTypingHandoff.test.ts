// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  type EarlyTypingKey,
  type EarlyTypingSink,
  startEarlyTypingHandoff,
} from "../earlyTypingHandoff";

/** A field whose text, focus and agreement the test drives directly. */
function field(options: { agrees?: boolean } = {}) {
  const state = {
    text: "",
    focused: false,
    caretRepairs: 0,
  };
  const sink: EarlyTypingSink = {
    hasFocus: () => state.focused,
    // A field that "disagrees" rewrites what it is given, so what it shows
    // never equals what the handoff expects.
    shows: () => (options.agrees === false ? "rewritten" : state.text),
    expects: () => state.text,
    applyKey: (key: EarlyTypingKey) => {
      state.text =
        "backspace" in key ? state.text.slice(0, -1) : state.text + key.insert;
    },
    repairCaret: () => {
      state.caretRepairs += 1;
    },
  };
  return { sink, state };
}

/** Returns false when a handler called preventDefault, as fireEvent does. */
function press(key: string): boolean {
  return window.dispatchEvent(
    new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }),
  );
}

const started: { cancel: () => void }[] = [];
afterEach(() => {
  for (const handoff of started.splice(0)) handoff.cancel();
  vi.useRealTimers();
});

function start(...args: Parameters<typeof startEarlyTypingHandoff>) {
  const handoff = startEarlyTypingHandoff(...args);
  started.push(handoff);
  return handoff;
}

describe("early typing handoff", () => {
  it("holds printable keys and Backspace for a field that does not exist yet", () => {
    const handoff = start();
    expect(press("h")).toBe(false);
    press("o");
    press("x");
    press("Backspace");
    expect(handoff.buffered()).toBe("ho");
  });

  it("leaves modified keys and named keys to the rest of the page", () => {
    const handoff = start();
    expect(
      window.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "r",
          ctrlKey: true,
          cancelable: true,
        }),
      ),
    ).toBe(true);
    expect(press("Enter")).toBe(true);
    expect(press("ArrowUp")).toBe(true);
    expect(handoff.buffered()).toBe("");
  });

  it("replays what it held into the field that claims it, in order", () => {
    const handoff = start();
    press("h");
    press("o");
    const { sink, state } = field();
    handoff.claim(sink);
    expect(state.text).toBe("ho");
    expect(handoff.buffered()).toBe("");
    press("w");
    expect(state.text).toBe("how");
  });

  it("keeps taking keys while the field has not caught up", () => {
    const { sink, state } = field();
    const handoff = start(sink);
    press("h");
    state.focused = true;
    // The field holds focus but still shows nothing, so a key typed into it
    // would report a value without the "h" and overwrite it.
    const shows = vi.spyOn(sink, "shows").mockReturnValue("");
    expect(press("o")).toBe(false);
    expect(state.text).toBe("ho");
    shows.mockRestore();
    expect(press("w")).toBe(true);
    expect(handoff.active()).toBe(false);
  });

  it("retires to a focused field that agrees, leaving the key to it", () => {
    const { sink, state } = field();
    const handoff = start(sink);
    press("h");
    state.focused = true;
    expect(press("o")).toBe(true);
    expect(state.text).toBe("h");
    expect(handoff.active()).toBe(false);
  });

  it("hands over to a field that rewrites its own text, and repairs the caret", () => {
    const { sink, state } = field({ agrees: false });
    const handoff = start(sink, { attempts: 2 });
    press("h");
    state.focused = true;
    handoff.retireWhenReady();
    expect(handoff.active()).toBe(true);
    press("o");
    expect(handoff.active()).toBe(false);
    expect(state.caretRepairs).toBe(1);
  });

  it("gives up when nobody claims the keys", () => {
    vi.useFakeTimers();
    const handoff = start(undefined, { expireMs: 1000 });
    press("h");
    vi.advanceTimersByTime(1000);
    expect(handoff.active()).toBe(false);
    expect(press("o")).toBe(true);
  });

  it("stops expiring once a field has claimed the keys", () => {
    vi.useFakeTimers();
    const handoff = start(undefined, { expireMs: 1000 });
    const { sink } = field();
    handoff.claim(sink);
    vi.advanceTimersByTime(5000);
    expect(handoff.active()).toBe(true);
  });

  it("stops intercepting after cancel", () => {
    const handoff = start();
    handoff.cancel();
    expect(press("h")).toBe(true);
    expect(handoff.buffered()).toBe("");
  });
});
