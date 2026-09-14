// @vitest-environment jsdom

import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { asClientSummarySourceKey } from "../../lib/clientSummaryStore";
import { useDraftPersistence } from "../useDraftPersistence";

function readStoredText(key: string): string | null {
  const raw = window.localStorage.getItem(key);
  if (!raw) return null;
  return (JSON.parse(raw) as { text?: string }).text ?? null;
}

function readStoredPendingSend(key: string): boolean {
  const raw = window.localStorage.getItem(key);
  if (!raw) return false;
  return (JSON.parse(raw) as { pendingSend?: boolean }).pendingSend === true;
}

function readStoredAttachmentCount(key: string): number {
  const raw = window.localStorage.getItem(key);
  if (!raw) return 0;
  const parsed = JSON.parse(raw) as { attachments?: { refs?: unknown[] } };
  return parsed.attachments?.refs?.length ?? 0;
}

function installLocalStorageMock(): Map<string, string> {
  const store = new Map<string, string>();
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    value: {
      getItem: vi.fn((key: string) => store.get(key) ?? null),
      setItem: vi.fn((key: string, value: string) => {
        store.set(key, value);
      }),
      removeItem: vi.fn((key: string) => {
        store.delete(key);
      }),
      key: vi.fn((index: number) => [...store.keys()][index] ?? null),
      get length() {
        return store.size;
      },
    },
  });
  return store;
}

describe("useDraftPersistence", () => {
  let store: Map<string, string>;

  beforeEach(() => {
    vi.useFakeTimers();
    store = installLocalStorageMock();
  });

  afterEach(() => {
    vi.useRealTimers();
    store.clear();
  });

  it("persists each draft edit immediately", () => {
    const { result } = renderHook(() => useDraftPersistence("draft-test"));

    act(() => {
      result.current[1]("still typing");
    });

    expect(readStoredText("draft-test")).toBe("still typing");

    act(() => {
      window.dispatchEvent(new Event("pagehide"));
    });

    expect(readStoredText("draft-test")).toBe("still typing");
  });

  it("keeps the explicit flush control harmless for blur handlers", () => {
    const { result } = renderHook(() => useDraftPersistence("draft-test"));

    act(() => {
      result.current[1]("blur save");
    });

    expect(readStoredText("draft-test")).toBe("blur save");

    act(() => {
      result.current[2].flushDraft();
    });

    expect(readStoredText("draft-test")).toBe("blur save");
  });

  it("does not let a delayed submission acknowledgement clear a newer draft", () => {
    const { result } = renderHook(() => useDraftPersistence("draft-test"));

    act(() => {
      result.current[1]("submitted turn");
      result.current[2].clearInput();
      result.current[1]("next turn draft");
      result.current[2].confirmInputClear();
    });

    expect(result.current[0]).toBe("next turn draft");
    expect(readStoredText("draft-test")).toBe("next turn draft");
  });

  it("removes the recovery copy when the cleared input stays empty", () => {
    const { result } = renderHook(() => useDraftPersistence("draft-test"));

    act(() => {
      result.current[1]("submitted turn");
      result.current[2].clearInput();
      result.current[2].confirmInputClear();
    });

    expect(result.current[0]).toBe("");
    expect(window.localStorage.getItem("draft-test")).toBe(null);
  });

  it("marks the surviving recovery copy as a pending send", () => {
    const { result } = renderHook(() => useDraftPersistence("draft-test"));

    act(() => {
      result.current[1]("submitted turn");
      result.current[2].clearInput();
    });

    expect(result.current[0]).toBe("");
    expect(readStoredText("draft-test")).toBe("submitted turn");
    expect(readStoredPendingSend("draft-test")).toBe(true);
  });

  it("discards a hydrated recovery copy the session already accounts for", () => {
    const { result: sender } = renderHook(() =>
      useDraftPersistence("draft-test"),
    );

    act(() => {
      sender.current[1]("submitted turn");
      sender.current[2].clearInput();
    });

    // A second tab on the same session hydrates the marked recovery copy.
    const { result: sibling } = renderHook(() =>
      useDraftPersistence("draft-test"),
    );
    expect(sibling.current[0]).toBe("submitted turn");

    let discarded = false;
    act(() => {
      discarded = sibling.current[2].discardPendingSendDraft(
        (text) => text === "submitted turn",
      );
    });

    expect(discarded).toBe(true);
    expect(sibling.current[0]).toBe("");
    expect(window.localStorage.getItem("draft-test")).toBe(null);
  });

  it("keeps a recovery copy the session cannot account for", () => {
    const { result: sender } = renderHook(() =>
      useDraftPersistence("draft-test"),
    );

    act(() => {
      sender.current[1]("never landed");
      sender.current[2].clearInput();
    });

    const { result: sibling } = renderHook(() =>
      useDraftPersistence("draft-test"),
    );

    let discarded = true;
    act(() => {
      discarded = sibling.current[2].discardPendingSendDraft(() => false);
    });

    expect(discarded).toBe(false);
    expect(sibling.current[0]).toBe("never landed");
    expect(readStoredText("draft-test")).toBe("never landed");
  });

  it("never discards a draft the user typed or recalled", () => {
    const { result } = renderHook(() => useDraftPersistence("draft-test"));

    act(() => {
      result.current[1]("submitted turn");
      result.current[2].clearInput();
      // Composer recall puts an already-sent turn back for deliberate resend.
      result.current[2].setDraft("submitted turn");
    });

    expect(readStoredPendingSend("draft-test")).toBe(false);

    let discarded = true;
    act(() => {
      discarded = result.current[2].discardPendingSendDraft(() => true);
    });

    expect(discarded).toBe(false);
    expect(result.current[0]).toBe("submitted turn");
  });

  it("never discards text restored after a failed send", () => {
    const { result } = renderHook(() => useDraftPersistence("draft-test"));

    act(() => {
      result.current[1]("submitted turn");
      result.current[2].clearInput();
      result.current[2].restoreFromStorage();
    });

    expect(result.current[0]).toBe("submitted turn");

    let discarded = true;
    act(() => {
      discarded = result.current[2].discardPendingSendDraft(() => true);
    });

    expect(discarded).toBe(false);
    expect(result.current[0]).toBe("submitted turn");
  });

  it("reads legacy raw-string drafts and rewrites them as envelopes", () => {
    store.set("draft-test", "legacy draft");

    const { result } = renderHook(() => useDraftPersistence("draft-test"));

    expect(result.current[0]).toBe("legacy draft");

    act(() => {
      result.current[1]("updated draft");
    });

    expect(readStoredText("draft-test")).toBe("updated draft");
  });

  it("ignores malformed envelope values without crashing", () => {
    store.set("draft-test", '{"version":1,');

    const { result } = renderHook(() => useDraftPersistence("draft-test"));

    expect(result.current[0]).toBe("");

    act(() => {
      result.current[1]("recovered");
    });

    expect(readStoredText("draft-test")).toBe("recovered");
  });

  it("removes empty text-only envelopes", () => {
    const { result } = renderHook(() => useDraftPersistence("draft-test"));

    act(() => {
      result.current[1]("temporary draft");
    });
    act(() => {
      result.current[1]("");
    });

    expect(window.localStorage.getItem("draft-test")).toBe(null);
  });

  it("persists attachment state in the same draft envelope", () => {
    const { result } = renderHook(() => useDraftPersistence("draft-test"));
    const attachmentState = {
      batchId: "batch-a",
      updatedAt: "2026-06-28T00:00:00.000Z",
      refs: [
        {
          id: "file-a",
          batchId: "batch-a",
          originalName: "screenshot.png",
          name: "uuid_screenshot.png",
          size: 123,
          mimeType: "image/png",
          createdAt: "2026-06-28T00:00:00.000Z",
          updatedAt: "2026-06-28T00:00:00.000Z",
        },
      ],
    };

    act(() => {
      result.current[1]("draft text");
    });
    act(() => {
      result.current[2].setAttachmentState(attachmentState);
    });

    expect(readStoredText("draft-test")).toBe("draft text");
    expect(readStoredAttachmentCount("draft-test")).toBe(1);
    expect(result.current[2].getAttachmentState()).toEqual(attachmentState);

    act(() => {
      result.current[2].setAttachmentState(null);
    });

    expect(readStoredText("draft-test")).toBe("draft text");
    expect(readStoredAttachmentCount("draft-test")).toBe(0);
  });

  it("updates source draft indexes for session drafts", () => {
    const sourceKey = asClientSummarySourceKey("host:macbook");
    const { result } = renderHook(() =>
      useDraftPersistence("draft-message:host%3Amacbook:session-a", {
        sessionDraft: { sourceKey, sessionId: "session-a" },
      }),
    );

    act(() => {
      result.current[1]("indexed draft");
    });

    const setItem = vi.mocked(window.localStorage.setItem);
    expect(setItem.mock.calls.map(([key]) => key)).toEqual([
      "draft-message:host%3Amacbook:session-a",
      "draft-presence-message:host%3Amacbook:session-a",
    ]);
    expect(
      window.localStorage.getItem("draft-message:host%3Amacbook:session-a"),
    ).not.toBe(null);
    expect(readStoredText("draft-message:host%3Amacbook:session-a")).toBe(
      "indexed draft",
    );
    expect(
      window.localStorage.getItem(
        "draft-presence-message:host%3Amacbook:session-a",
      ),
    ).toBe("1");

    setItem.mockClear();
    act(() => {
      result.current[1]("indexed draft keeps changing");
    });
    expect(setItem.mock.calls.map(([key]) => key)).toEqual([
      "draft-message:host%3Amacbook:session-a",
    ]);

    act(() => {
      result.current[2].clearDraft();
    });

    expect(
      window.localStorage.getItem("draft-message:host%3Amacbook:session-a"),
    ).toBe(null);
    expect(
      window.localStorage.getItem(
        "draft-presence-message:host%3Amacbook:session-a",
      ),
    ).toBe(null);
  });
});
