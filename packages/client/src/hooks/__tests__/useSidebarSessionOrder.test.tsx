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
      // Old on every signal, including the write time the order now counts.
      { id: "old", createdAt: old, updatedAt: old, observedAt: 0 },
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

  it("keeps a local send ahead of an older turn from elsewhere", () => {
    const source = createClientSummaryHostSourceKey("local-send");
    setCurrentClientSummarySourceKey(source);
    const rows: SessionCollectionRecord[] = [
      {
        id: "answered-elsewhere",
        createdAt: new Date(Date.now() - 86400000).toISOString(),
        lastHumanTurnAt: new Date(Date.now() - 60000).toISOString(),
        observedAt: 0,
      },
      {
        id: "sent-here",
        createdAt: new Date(Date.now() - 86400000).toISOString(),
        observedAt: 0,
      },
    ];
    const { result } = renderHook(() => useSidebarSessionOrder(rows, []));
    act(() => recordSessionInteraction(source, "sent-here"));
    expect(result.current.recent.map((row) => row.id)).toEqual([
      "sent-here",
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

  it("keeps a session an agent worked in today out of older work", () => {
    // Created weeks ago, never opened in this browser, and no reported human
    // turn: only the provider write time says this ran an hour ago. Without it
    // the session sat under older work while the agent was still writing.
    setCurrentClientSummarySourceKey(
      createClientSummaryHostSourceKey("worked-in-today"),
    );
    const weeksAgo = new Date(Date.now() - 21 * 86400000).toISOString();
    const rows: SessionCollectionRecord[] = [
      {
        id: "agent-busy",
        createdAt: weeksAgo,
        updatedAt: new Date(Date.now() - 3600000).toISOString(),
        observedAt: 0,
      },
      { id: "quiet", createdAt: weeksAgo, updatedAt: weeksAgo, observedAt: 0 },
    ];
    const { result } = renderHook(() => useSidebarSessionOrder(rows, []));
    expect(result.current.recent.map((row) => row.id)).toEqual(["agent-busy"]);
    expect(result.current.older.map((row) => row.id)).toEqual(["quiet"]);
  });

  it("keeps a local visit ahead of quieter provider writes", () => {
    const source = createClientSummaryHostSourceKey("visit-ahead");
    setCurrentClientSummarySourceKey(source);
    const rows: SessionCollectionRecord[] = [
      {
        id: "written-an-hour-ago",
        updatedAt: new Date(Date.now() - 3600000).toISOString(),
        observedAt: 0,
      },
      {
        id: "opened-just-now",
        updatedAt: new Date(Date.now() - 2 * 3600000).toISOString(),
        observedAt: 0,
      },
    ];
    const { result } = renderHook(() => useSidebarSessionOrder(rows, []));
    act(() => recordSessionInteraction(source, "opened-just-now"));
    expect(result.current.recent.map((row) => row.id)).toEqual([
      "opened-just-now",
      "written-an-hour-ago",
    ]);
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
