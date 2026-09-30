import {
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type HTMLAttributes,
} from "react";
import { useClientSummarySourceKey } from "../lib/clientSummaryStore";
import type { SessionCollectionRecord } from "../lib/clientSummaryCollections";
import { getSessionInteractionStore } from "../lib/sessionInteractionOrder";

/** One named sidebar section: a user-made category or a limited user. */
export interface SidebarSessionGroup<T> {
  name: string;
  rows: readonly T[];
}

function compareGroupNames(a: string, b: string): number {
  return (
    a.localeCompare(b, undefined, { sensitivity: "base" }) || a.localeCompare(b)
  );
}

/**
 * Sidebar chronology belongs to the user, independently of agent liveness.
 *
 * Sessions file under exactly one section, first match wins: Starred, then
 * their sidebar category, then (when `groupByCreator`) the limited user who
 * started them, then Last 24 Hours or Older.
 */
export function useSidebarSessionOrder(
  records: readonly SessionCollectionRecord[],
  starred: readonly SessionCollectionRecord[],
  categorized: readonly SessionCollectionRecord[] = [],
  groupByCreator = false,
) {
  const sourceKey = useClientSummarySourceKey();
  const store = getSessionInteractionStore(sourceKey);
  const raw = useSyncExternalStore(store.subscribe, store.read, store.read);
  return useMemo(() => {
    const interactions = new Map<string, number>(JSON.parse(raw));
    // This browser's own record of when the reader last wrote into each
    // session, and the server's record of when anyone did. The local one alone
    // would place a session by what *this* browser sent, so a session the
    // reader had answered on another device would file under older work,
    // where it was hard to find. Taking the later of the two moves a row as
    // soon as it is sent to, before the server reports the turn, while a fresh
    // browser with nothing stored still lands on the same chronology.
    const time = (record: SessionCollectionRecord) =>
      Math.max(
        interactions.get(record.id) ?? 0,
        Date.parse(record.lastHumanTurnAt ?? "") || 0,
        // Nothing has been written into it yet, or the provider does not report
        // it: fall back to when the session appeared.
        Date.parse(record.createdAt ?? "") || 0,
        // Provider write time, which upstream deliberately leaves out so agent
        // output cannot move a row while someone is reading it. That holds
        // where a reader time exists, and here one usually does not: the
        // retained feed the sidebar reads reports no human turn at all, and the
        // catalog drops a session's creation time for as long as an agent is
        // appending to it. Sessions this fork runs headless are never opened in
        // a browser either, so a whole day of them sorted below work nobody had
        // touched in weeks, and a phone with cleared storage showed almost
        // nothing at all under Last 24 Hours. The list has to answer what ran
        // recently, on any device, so the newest signal wins.
        Date.parse(record.updatedAt ?? "") || 0,
      );
    const order = (rows: readonly SessionCollectionRecord[]) =>
      [...rows].sort((a, b) => time(b) - time(a) || a.id.localeCompare(b.id));
    const cutoff = Date.now() - 24 * 60 * 60 * 1000;
    // The categorized feed reaches past the recent page; merge it in once.
    const merged = new Map<string, SessionCollectionRecord>();
    for (const record of [...records, ...categorized]) {
      merged.set(record.id, record);
    }
    const categories = new Map<string, SessionCollectionRecord[]>();
    const creators = new Map<string, SessionCollectionRecord[]>();
    const ordinary: SessionCollectionRecord[] = [];
    for (const record of merged.values()) {
      if (record.isStarred || record.isArchived) continue;
      const group = record.sidebarCategory
        ? categories
        : groupByCreator && record.createdByUser
          ? creators
          : null;
      const key = record.sidebarCategory || record.createdByUser;
      if (group && key) {
        group.set(key, [...(group.get(key) ?? []), record]);
      } else {
        ordinary.push(record);
      }
    }
    const groups = (byName: Map<string, SessionCollectionRecord[]>) =>
      [...byName.keys()]
        .sort(compareGroupNames)
        .map((name) => ({ name, rows: order(byName.get(name) ?? []) }));
    return {
      starred: order(starred),
      categories: groups(categories),
      recent: order(ordinary.filter((record) => time(record) >= cutoff)),
      creators: groups(creators),
      older: order(ordinary.filter((record) => time(record) < cutoff)),
    };
  }, [raw, records, starred, categorized, groupByCreator]);
}

/** Section key → rows, in display order. Named sections use prefixed keys. */
type SidebarLists<T> = Record<string, readonly T[]>;

/**
 * Hold layout identities, while resolving every row from current live data.
 *
 * A held layout keeps its sections and their order. A section that appears
 * during the hold stays empty until release, so a row moving into a new
 * section shows once, in its old place, rather than twice.
 */
export function useHeldSidebarLists<
  T extends { id: string },
  L extends SidebarLists<T>,
>(lists: L, enabled: boolean) {
  const sourceKey = useClientSummarySourceKey();
  const pointer = useRef(false);
  const focused = useRef(false);
  const touch = useRef(false);
  const [held, setHeld] = useState<{
    sourceKey: string;
    lists: L;
  } | null>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: Source and enabled changes intentionally release the hold; the reset body does not need their values.
  useLayoutEffect(() => {
    pointer.current = false;
    focused.current = false;
    touch.current = false;
    setHeld(null);
  }, [sourceKey, enabled]);
  const hasRows = Object.values(lists).some((rows) => rows.length > 0);
  // There is no navigation target to protect until the first rows arrive.
  // Capture that first population before paint if interaction is still active.
  useLayoutEffect(() => {
    if (
      enabled &&
      hasRows &&
      held === null &&
      (pointer.current || focused.current || touch.current)
    ) {
      setHeld({ sourceKey, lists });
    }
  }, [enabled, hasRows, held, lists, sourceKey]);
  const hold = () => {
    if (!enabled || !hasRows) return;
    setHeld((previous) =>
      previous?.sourceKey === sourceKey
        ? previous
        : {
            sourceKey,
            lists,
          },
    );
  };
  const release = () => {
    if (!pointer.current && !focused.current && !touch.current) setHeld(null);
  };
  const handlers: HTMLAttributes<HTMLElement> = {
    onPointerEnter: (event) => {
      if (event.pointerType === "touch") return;
      pointer.current = true;
      hold();
    },
    onPointerLeave: () => {
      pointer.current = false;
      release();
    },
    onPointerDown: (event) => {
      if (event.pointerType !== "touch") return;
      touch.current = true;
      hold();
    },
    onPointerCancel: () => {
      touch.current = false;
      release();
    },
    onClick: () => {
      // Release after the click has reached its original target, not on up.
      touch.current = false;
      release();
    },
    onFocusCapture: () => {
      focused.current = true;
      hold();
    },
    onBlurCapture: (event) => {
      if (event.currentTarget.contains(event.relatedTarget)) return;
      focused.current = false;
      release();
    },
  };
  if (!enabled || held?.sourceKey !== sourceKey) return { lists, handlers };
  const current = new Map(
    Object.values(lists)
      .flat()
      .map((row) => [row.id, row]),
  );
  const visible: SidebarLists<T> = {};
  for (const [key, rows] of Object.entries(held.lists)) {
    visible[key] = rows.flatMap(({ id }) => {
      const row = current.get(id);
      return row ? [row] : [];
    });
  }
  for (const key of Object.keys(lists)) visible[key] ??= [];
  return { lists: visible as L, handlers };
}
