import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import {
  COMMAND_RECALL_STORAGE_KEY,
  MAX_COMMAND_RECALL_SESSIONS,
  readSessionCommandRecall,
  recordSessionCommandRecall,
  useSessionCommandRecall,
} from "../sessionCommandRecall";

function recallKeys(): string[] {
  const keys: string[] = [];
  for (let position = 0; position < window.localStorage.length; position += 1) {
    const key = window.localStorage.key(position);
    if (key?.startsWith(COMMAND_RECALL_STORAGE_KEY)) keys.push(key);
  }
  return keys.sort();
}

function texts(sessionId: string): string[] {
  return readSessionCommandRecall(sessionId).map((entry) => entry.text);
}

describe("session command recall", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("keeps a session's commands newest first without repeats", () => {
    recordSessionCommandRecall("s1", "/clear 2", 1);
    recordSessionCommandRecall("s1", "/fork 1", 2);
    recordSessionCommandRecall("s1", "/clear 2", 3);

    expect(texts("s1")).toEqual(["/clear 2", "/fork 1"]);
    expect(texts("s2")).toEqual([]);
  });

  it("holds every session under one key and drops the least recently used", () => {
    for (let index = 0; index <= MAX_COMMAND_RECALL_SESSIONS; index += 1) {
      recordSessionCommandRecall(`s${index}`, `/clear ${index}`, index);
    }

    expect(recallKeys()).toEqual([COMMAND_RECALL_STORAGE_KEY]);
    expect(texts("s0")).toEqual([]);
    expect(texts("s1")).toEqual(["/clear 1"]);
    expect(texts(`s${MAX_COMMAND_RECALL_SESSIONS}`)).toEqual([
      `/clear ${MAX_COMMAND_RECALL_SESSIONS}`,
    ]);
  });

  it("keeps a session recently used by recording into it", () => {
    recordSessionCommandRecall("s0", "/clear 1", 0);
    for (let index = 1; index < MAX_COMMAND_RECALL_SESSIONS; index += 1) {
      recordSessionCommandRecall(`s${index}`, "/clear 1", index);
    }
    recordSessionCommandRecall("s0", "/fork 1", 100);
    recordSessionCommandRecall("new", "/clear 1", 101);

    expect(texts("s0")).toEqual(["/fork 1", "/clear 1"]);
    expect(texts("s1")).toEqual([]);
  });

  it("folds per-session keys from earlier releases into the shared key", () => {
    window.localStorage.setItem(
      `${COMMAND_RECALL_STORAGE_KEY}:older`,
      JSON.stringify([
        { id: "ya-command-recall-10", text: "/clear 1", preview: "/clear 1" },
      ]),
    );
    window.localStorage.setItem(
      `${COMMAND_RECALL_STORAGE_KEY}:newer`,
      JSON.stringify([
        { id: "ya-command-recall-20", text: "/fork 2", preview: "/fork 2" },
      ]),
    );
    window.localStorage.setItem(`${COMMAND_RECALL_STORAGE_KEY}:broken`, "{");

    expect(texts("older")).toEqual(["/clear 1"]);
    expect(recallKeys()).toEqual([COMMAND_RECALL_STORAGE_KEY]);
    const stored = JSON.parse(
      window.localStorage.getItem(COMMAND_RECALL_STORAGE_KEY) ?? "{}",
    );
    expect(
      stored.sessions.map(
        (session: { sessionId: string }) => session.sessionId,
      ),
    ).toEqual(["newer", "older"]);
  });

  it("records on top of what another tab stored", () => {
    const { result } = renderHook(() => useSessionCommandRecall("s1"));
    recordSessionCommandRecall("s1", "/fork 1", 1);

    act(() => {
      result.current.record("/clear 2");
    });

    expect(result.current.entries.map((entry) => entry.text)).toEqual([
      "/clear 2",
      "/fork 1",
    ]);
  });

  it("follows the page to another session", () => {
    recordSessionCommandRecall("s1", "/clear 1", 1);
    recordSessionCommandRecall("s2", "/fork 2", 2);
    const { result, rerender } = renderHook(
      ({ sessionId }) => useSessionCommandRecall(sessionId),
      { initialProps: { sessionId: "s1" } },
    );
    expect(result.current.entries.map((entry) => entry.text)).toEqual([
      "/clear 1",
    ]);

    rerender({ sessionId: "s2" });
    expect(result.current.entries.map((entry) => entry.text)).toEqual([
      "/fork 2",
    ]);

    act(() => {
      result.current.record("/clear 3");
    });
    expect(texts("s2")).toEqual(["/clear 3", "/fork 2"]);
    expect(texts("s1")).toEqual(["/clear 1"]);
  });
});
