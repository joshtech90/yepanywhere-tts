import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { useSidebarSessionOrder } from "../useSidebarSessionOrder";
import {
  getSessionInteractionStore,
  recordSessionInteraction,
} from "../../lib/sessionInteractionOrder";
import {
  createClientSummaryHostSourceKey,
  setCurrentClientSummarySourceKey,
} from "../../lib/clientSummaryStore";
import { invalidateLocalStorageValues } from "../../lib/localStorageValue";
import type { SessionCollectionRecord } from "../../lib/clientSummaryCollections";

afterEach(() => {
  cleanup();
  localStorage.clear();
  invalidateLocalStorageValues();
});

describe("sidebar user chronology", () => {
  it("retains user recency across remounts and isolates sources", () => {
    const first = createClientSummaryHostSourceKey("order-first");
    const other = createClientSummaryHostSourceKey("order-other");
    setCurrentClientSummarySourceKey(first);
    const old = new Date(Date.now() - 3 * 86400000).toISOString();
    const rows: SessionCollectionRecord[] = [
      {
        id: "old",
        createdAt: old,
        updatedAt: new Date().toISOString(),
        observedAt: 0,
      },
      { id: "new", createdAt: new Date().toISOString(), observedAt: 0 },
    ];
    const mounted = renderHook(() => useSidebarSessionOrder(rows, []));
    expect(mounted.result.current.recent.map((row) => row.id)).toEqual(["new"]);
    expect(mounted.result.current.older.map((row) => row.id)).toEqual(["old"]);
    act(() => recordSessionInteraction(first, "old"));
    expect(mounted.result.current.recent.map((row) => row.id)).toEqual([
      "old",
      "new",
    ]);
    mounted.unmount();
    invalidateLocalStorageValues();
    const remounted = renderHook(() => useSidebarSessionOrder(rows, []));
    expect(remounted.result.current.recent.map((row) => row.id)).toEqual([
      "old",
      "new",
    ]);
    act(() => setCurrentClientSummarySourceKey(other));
    expect(remounted.result.current.recent.map((row) => row.id)).toEqual([
      "new",
    ]);
    act(() => recordSessionInteraction(first, "new"));
    expect(remounted.result.current.older.map((row) => row.id)).toEqual([
      "old",
    ]);
  });

  it("places a session the reader answered on another device", () => {
    // Nothing stored here: this browser has never opened either session, the
    // position a second device would otherwise have kept to itself.
    setCurrentClientSummarySourceKey(
      createClientSummaryHostSourceKey("fresh-browser"),
    );
    const old = new Date(Date.now() - 3 * 86400000).toISOString();
    const rows: SessionCollectionRecord[] = [
      {
        id: "answered-elsewhere",
        createdAt: old,
        lastHumanTurnAt: new Date(Date.now() - 60000).toISOString(),
        updatedAt: new Date().toISOString(),
        observedAt: 0,
      },
      { id: "untouched", createdAt: old, observedAt: 0 },
    ];
    const { result } = renderHook(() => useSidebarSessionOrder(rows, []));
    expect(result.current.recent.map((row) => row.id)).toEqual([
      "answered-elsewhere",
    ]);
    expect(result.current.older.map((row) => row.id)).toEqual(["untouched"]);
  });

  it("keeps a local visit ahead of an older turn from elsewhere", () => {
    const source = createClientSummaryHostSourceKey("local-visit");
    setCurrentClientSummarySourceKey(source);
    const rows: SessionCollectionRecord[] = [
      {
        id: "answered-elsewhere",
        createdAt: new Date(Date.now() - 86400000).toISOString(),
        lastHumanTurnAt: new Date(Date.now() - 60000).toISOString(),
        observedAt: 0,
      },
      {
        id: "opened-here",
        createdAt: new Date(Date.now() - 86400000).toISOString(),
        observedAt: 0,
      },
    ];
    const { result } = renderHook(() => useSidebarSessionOrder(rows, []));
    act(() => recordSessionInteraction(source, "opened-here"));
    expect(result.current.recent.map((row) => row.id)).toEqual([
      "opened-here",
      "answered-elsewhere",
    ]);
  });

  it("places a session whose feed carries only provider write time", () => {
    // What the retained sidebar collection actually sends for a session an
    // agent is writing in: no creation time, no reported human turn, and a
    // browser that has never opened it. Without the write-time fallback both
    // rows sorted as the epoch and a day of headless work read as missing.
    setCurrentClientSummarySourceKey(
      createClientSummaryHostSourceKey("write-time-only"),
    );
    const rows: SessionCollectionRecord[] = [
      {
        id: "worked-in-today",
        updatedAt: new Date(Date.now() - 3600000).toISOString(),
        observedAt: 0,
      },
      {
        id: "quiet-since-last-week",
        updatedAt: new Date(Date.now() - 7 * 86400000).toISOString(),
        observedAt: 0,
      },
    ];
    const { result } = renderHook(() => useSidebarSessionOrder(rows, []));
    expect(result.current.recent.map((row) => row.id)).toEqual([
      "worked-in-today",
    ]);
    expect(result.current.older.map((row) => row.id)).toEqual([
      "quiet-since-last-week",
    ]);
  });

  it("does not let provider write time outrank the reader's own place", () => {
    const source = createClientSummaryHostSourceKey("reader-wins");
    setCurrentClientSummarySourceKey(source);
    const rows: SessionCollectionRecord[] = [
      {
        id: "agent-busy",
        createdAt: new Date(Date.now() - 5 * 86400000).toISOString(),
        updatedAt: new Date().toISOString(),
        observedAt: 0,
      },
      {
        id: "read-yesterday",
        createdAt: new Date(Date.now() - 5 * 86400000).toISOString(),
        updatedAt: new Date(Date.now() - 5 * 86400000).toISOString(),
        observedAt: 0,
      },
    ];
    const { result } = renderHook(() => useSidebarSessionOrder(rows, []));
    act(() => recordSessionInteraction(source, "read-yesterday"));
    expect(result.current.recent.map((row) => row.id)).toEqual([
      "read-yesterday",
    ]);
    expect(result.current.older.map((row) => row.id)).toEqual(["agent-busy"]);
  });

  it("ignores malformed stored history and bounds retained interactions", () => {
    const source = "bounded-order";
    localStorage.setItem(`yep-sidebar-interactions:${source}`, '{"bad":true}');
    expect(getSessionInteractionStore(source).read()).toBe("[]");
    for (let index = 0; index < 1002; index++) {
      recordSessionInteraction(source, `session-${index}`, 1000);
    }
    const saved = JSON.parse(getSessionInteractionStore(source).read());
    expect(saved).toHaveLength(1000);
    expect(saved[0][0]).toBe("session-1001");
    expect(saved.at(-1)[0]).toBe("session-2");
  });
});
