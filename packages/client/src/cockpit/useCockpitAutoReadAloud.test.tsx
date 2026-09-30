import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  playReadAloud: vi.fn(async () => {}),
  stopReadAloud: vi.fn(),
}));

vi.mock("../lib/readAloud", () => ({
  playReadAloud: mocks.playReadAloud,
  stopReadAloud: mocks.stopReadAloud,
}));

import type { RenderItem } from "@yep-anywhere/shared/transcript/items";
import type {
  CockpitAssistantEntry,
  CockpitTranscriptEntry,
} from "./core/sessionDetail";
import {
  COCKPIT_AUTO_READ_EXTERNAL_SETTLE_MS,
  COCKPIT_AUTO_READ_SETTLE_MS,
  type CockpitAutoReadAloudInput,
  finalCockpitAnswer,
  resetCockpitAutoReadCache,
  useCockpitAutoReadAloud,
} from "./useCockpitAutoReadAloud";

const STORAGE_KEY = "yep-cockpit-auto-read-sessions";

function answer(
  key: string,
  text: string,
  extra: Partial<CockpitAssistantEntry> = {},
): CockpitAssistantEntry {
  return {
    key,
    kind: "assistant",
    text: [{ id: key, text, isStreaming: false, abortedMidStream: false }],
    thinking: [],
    spokenText: text,
    isStreaming: false,
    ...extra,
  };
}

function user(key: string): CockpitTranscriptEntry {
  return { key, kind: "user", text: "Frage" };
}

function setup(initial: Partial<CockpitAutoReadAloudInput> = {}) {
  const props: CockpitAutoReadAloudInput = {
    sessionId: "session-a",
    entries: [user("u1"), answer("a1", "Alte Antwort")],
    loaded: true,
    working: false,
    ...initial,
  };
  const hook = renderHook(
    (p: CockpitAutoReadAloudInput) => useCockpitAutoReadAloud(p),
    {
      initialProps: props,
    },
  );
  const update = (patch: Partial<CockpitAutoReadAloudInput>) => {
    Object.assign(props, patch);
    hook.rerender({ ...props });
  };
  return { ...hook, update };
}

function settle(ms = COCKPIT_AUTO_READ_SETTLE_MS) {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
  resetCockpitAutoReadCache();
  mocks.playReadAloud.mockClear();
  mocks.stopReadAloud.mockClear();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("finalCockpitAnswer", () => {
  it("accepts only a finished, complete answer as the last entry", () => {
    expect(finalCockpitAnswer([user("u1"), answer("a1", "Fertig")])?.key).toBe(
      "a1",
    );
    expect(finalCockpitAnswer([answer("a1", "Fertig"), user("u2")])).toBe(null);
    expect(
      finalCockpitAnswer([answer("a1", "Halb", { isStreaming: true })]),
    ).toBe(null);
    expect(finalCockpitAnswer([answer("a1", "  ")])).toBe(null);
    expect(
      finalCockpitAnswer([
        answer("a1", "Fertig"),
        { key: "b1", kind: "boundary", subtype: "status" },
      ])?.key,
    ).toBe("a1");
    expect(
      finalCockpitAnswer([
        answer("a1", "Abgebrochen", {
          text: [
            {
              id: "a1",
              text: "Abgebrochen",
              isStreaming: false,
              abortedMidStream: true,
            },
          ],
        }),
      ]),
    ).toBe(null);
  });
});

describe("useCockpitAutoReadAloud", () => {
  it("is off by default and reads nothing when a turn ends", () => {
    const { result, update } = setup();
    expect(result.current.enabled).toBe(false);

    update({ working: true });
    update({
      working: false,
      entries: [user("u1"), answer("a1", "Alt"), answer("a2", "Neu")],
    });
    settle();

    expect(mocks.playReadAloud).not.toHaveBeenCalled();
  });

  it("reads the final answer once a turn of the open session ends", () => {
    const { result, update } = setup();
    act(() => result.current.toggle());
    expect(result.current.enabled).toBe(true);

    update({
      working: true,
      entries: [user("u1"), answer("a1", "Alt"), user("u2")],
    });
    update({
      entries: [
        user("u1"),
        answer("a1", "Alt"),
        user("u2"),
        answer("a2", "Zwischenstand"),
      ],
    });
    expect(mocks.playReadAloud).not.toHaveBeenCalled();

    update({
      working: false,
      entries: [
        user("u1"),
        answer("a1", "Alt"),
        user("u2"),
        answer("a2", "Zwischenstand"),
        answer("a3", "Endgültige Antwort"),
      ],
    });
    expect(mocks.playReadAloud).not.toHaveBeenCalled();
    settle();

    expect(mocks.playReadAloud).toHaveBeenCalledTimes(1);
    expect(mocks.playReadAloud).toHaveBeenCalledWith(
      "Endgültige Antwort",
      "a3",
    );

    // Later renders of the same idle state do not repeat it.
    update({ loaded: true });
    settle();
    expect(mocks.playReadAloud).toHaveBeenCalledTimes(1);
  });

  it("waits for a final answer that arrives just after the session goes idle", () => {
    const { result, update } = setup();
    act(() => result.current.toggle());

    update({
      working: true,
      entries: [user("u1"), answer("a1", "Alt"), user("u2")],
    });
    update({ working: false });
    expect(mocks.playReadAloud).not.toHaveBeenCalled();

    update({
      entries: [
        user("u1"),
        answer("a1", "Alt"),
        user("u2"),
        answer("a2", "Neu"),
      ],
    });
    settle();
    expect(mocks.playReadAloud).toHaveBeenCalledWith("Neu", "a2");
  });

  it("does not read when the turn ends on a tool call or a stopped answer", () => {
    const { result, update } = setup();
    act(() => result.current.toggle());

    update({
      working: true,
      entries: [user("u1"), answer("a1", "Alt"), user("u2")],
    });
    update({
      working: false,
      entries: [
        user("u1"),
        answer("a1", "Alt"),
        user("u2"),
        answer("a2", "Gestoppt", {
          text: [
            {
              id: "a2",
              text: "Gestoppt",
              isStreaming: false,
              abortedMidStream: true,
            },
          ],
        }),
      ],
    });
    settle();
    expect(mocks.playReadAloud).not.toHaveBeenCalled();
  });

  it("never reads what was already there when a session opens", () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(["session-a"]));
    const { result, update } = setup({ loaded: false, entries: [] });
    expect(result.current.enabled).toBe(true);

    update({ loaded: true, entries: [user("u1"), answer("a1", "Alt")] });
    settle();
    expect(mocks.playReadAloud).not.toHaveBeenCalled();
  });

  it("skips a turn whose start it saw before the transcript loaded", () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(["session-a"]));
    const { update } = setup({ loaded: false, entries: [], working: true });

    update({
      working: false,
      loaded: true,
      entries: [user("u1"), answer("a1", "Vorher schon da")],
    });
    settle();
    expect(mocks.playReadAloud).not.toHaveBeenCalled();
  });

  it("is remembered per session and only for that session", () => {
    const first = setup();
    act(() => first.result.current.toggle());
    first.unmount();

    resetCockpitAutoReadCache();
    const again = setup();
    expect(again.result.current.enabled).toBe(true);
    again.unmount();

    const other = setup({ sessionId: "session-b" });
    expect(other.result.current.enabled).toBe(false);
  });

  it("stops playback when switched off", () => {
    const { result } = setup();
    act(() => result.current.toggle());
    act(() => result.current.toggle());

    expect(result.current.enabled).toBe(false);
    expect(mocks.stopReadAloud).toHaveBeenCalledTimes(1);
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]")).toEqual([]);
  });

  it("carries the switch from a temporary id to the real session id", () => {
    const { result, update } = setup({ sessionId: "temp-1" });
    act(() => result.current.toggle());

    update({ actualSessionId: "real-1" });
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]")).toEqual([
      "real-1",
    ]);

    update({ sessionId: "real-1" });
    expect(result.current.enabled).toBe(true);
  });

  it("prefers a final answer that lands after an earlier text while settling", () => {
    const { result, update } = setup();
    act(() => result.current.toggle());
    const before = [user("u1"), answer("a1", "Alt"), user("u2")];

    update({ working: true, entries: before });
    update({
      working: false,
      entries: [...before, answer("a2", "Ich prüfe das")],
    });
    settle(COCKPIT_AUTO_READ_SETTLE_MS / 2);
    update({
      entries: [
        ...before,
        answer("a2", "Ich prüfe das"),
        { key: "t1", kind: "tool", tool: {} } as CockpitTranscriptEntry,
        answer("a3", "Endgültig"),
      ],
    });
    settle();

    expect(mocks.playReadAloud).toHaveBeenCalledTimes(1);
    expect(mocks.playReadAloud).toHaveBeenCalledWith("Endgültig", "a3");
  });

  it("waits out another program's pause between its text and the next tool", () => {
    const { result, update } = setup();
    act(() => result.current.toggle());
    const before = [user("u1"), answer("a1", "Alt"), user("u2")];

    update({ working: true, workingElsewhere: true, entries: before });
    update({
      working: false,
      workingElsewhere: false,
      entries: [...before, answer("a2", "Ich starte die Tests")],
    });
    settle();
    expect(mocks.playReadAloud).not.toHaveBeenCalled();
    update({ working: true, workingElsewhere: true });
    settle(COCKPIT_AUTO_READ_EXTERNAL_SETTLE_MS);
    expect(mocks.playReadAloud).not.toHaveBeenCalled();

    update({
      working: false,
      workingElsewhere: false,
      entries: [
        ...before,
        answer("a2", "Ich starte die Tests"),
        { key: "t1", kind: "tool", tool: {} } as CockpitTranscriptEntry,
        answer("a3", "Alle Tests grün"),
      ],
    });
    settle(COCKPIT_AUTO_READ_EXTERNAL_SETTLE_MS);
    expect(mocks.playReadAloud).toHaveBeenCalledTimes(1);
    expect(mocks.playReadAloud).toHaveBeenCalledWith("Alle Tests grün", "a3");
  });

  it("reads only the last message of answers grouped into one entry", () => {
    const first = { id: "m1" } as unknown as RenderItem["sourceMessages"][0];
    const second = { id: "m2" } as unknown as RenderItem["sourceMessages"][0];
    const grouped = answer("a2", "", {
      text: [
        {
          id: "m1-0",
          text: "Ich schaue nach.",
          isStreaming: false,
          abortedMidStream: false,
        },
        {
          id: "m2-0",
          text: "Hier ist das Ergebnis.",
          isStreaming: false,
          abortedMidStream: false,
        },
        {
          id: "m2-2",
          text: "Und ein Nachsatz.",
          isStreaming: false,
          abortedMidStream: false,
        },
      ],
      spokenText:
        "Ich schaue nach.\n\nHier ist das Ergebnis.\n\nUnd ein Nachsatz.",
      sourceItems: [
        { type: "text", id: "m1-0", sourceMessages: [first] },
        { type: "thinking", id: "m2-1", sourceMessages: [second] },
        { type: "text", id: "m2-0", sourceMessages: [second] },
        { type: "text", id: "m2-2", sourceMessages: [second] },
      ] as unknown as RenderItem[],
    });

    expect(finalCockpitAnswer([user("u1"), grouped])).toEqual({
      key: "m2-2",
      entryKey: "a2",
      text: "Hier ist das Ergebnis.\n\nUnd ein Nachsatz.",
    });
  });

  it("does not read a turn that ended in an abort", () => {
    const { result, update } = setup();
    act(() => result.current.toggle());
    const before = [user("u1"), answer("a1", "Alt"), user("u2")];

    update({ working: true, entries: before });
    update({
      working: false,
      aborted: true,
      entries: [...before, answer("a2", "Halbe Antwort")],
    });
    settle();
    expect(mocks.playReadAloud).not.toHaveBeenCalled();
  });

  it("does not read a turn the user stopped, but reads the next one", () => {
    const { result, update } = setup();
    act(() => result.current.toggle());
    const before = [user("u1"), answer("a1", "Alt"), user("u2")];

    update({ working: true, entries: before });
    act(() => result.current.skipTurn());
    update({
      working: false,
      entries: [...before, answer("a2", "Gestoppt")],
    });
    settle();
    expect(mocks.playReadAloud).not.toHaveBeenCalled();

    const next = [...before, answer("a2", "Gestoppt"), user("u3")];
    update({ working: true, entries: next });
    update({ working: false, entries: [...next, answer("a3", "Weiter")] });
    settle();
    expect(mocks.playReadAloud).toHaveBeenCalledWith("Weiter", "a3");
  });

  it("plays under the answer's entry key so its control can pause it", () => {
    const { result, update } = setup();
    act(() => result.current.toggle());
    const before = [user("u1"), answer("a1", "Alt"), user("u2")];

    update({ working: true, entries: before });
    update({
      working: false,
      entries: [
        ...before,
        answer("entry-7", "Antwort", {
          text: [
            {
              id: "message-7-0",
              text: "Antwort",
              isStreaming: false,
              abortedMidStream: false,
            },
          ],
        }),
      ],
    });
    settle();
    expect(mocks.playReadAloud).toHaveBeenCalledWith("Antwort", "entry-7");
  });
});
