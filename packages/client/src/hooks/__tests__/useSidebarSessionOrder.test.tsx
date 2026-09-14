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
