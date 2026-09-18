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
