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

import type {
  CockpitAssistantEntry,
  CockpitTranscriptEntry,
} from "./core/sessionDetail";
import {
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

beforeEach(() => {
  localStorage.clear();
  resetCockpitAutoReadCache();
  mocks.playReadAloud.mockClear();
  mocks.stopReadAloud.mockClear();
});
afterEach(cleanup);

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

    expect(mocks.playReadAloud).toHaveBeenCalledTimes(1);
    expect(mocks.playReadAloud).toHaveBeenCalledWith(
      "Endgültige Antwort",
      "a3",
    );

    // Later renders of the same idle state do not repeat it.
    update({ loaded: true });
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
    expect(mocks.playReadAloud).not.toHaveBeenCalled();
  });

  it("never reads what was already there when a session opens", () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(["session-a"]));
    const { result, update } = setup({ loaded: false, entries: [] });
    expect(result.current.enabled).toBe(true);

    update({ loaded: true, entries: [user("u1"), answer("a1", "Alt")] });
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
});
