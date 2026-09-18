import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type HTMLAttributes,
} from "react";
import { useClientSummarySourceKey } from "../lib/clientSummaryStore";
import type { SessionCollectionRecord } from "../lib/clientSummaryCollections";
import { getSessionInteractionStore } from "../lib/sessionInteractionOrder";

/** Sidebar chronology belongs to the user, independently of agent liveness. */
export function useSidebarSessionOrder(
  records: readonly SessionCollectionRecord[],
  starred: readonly SessionCollectionRecord[],
) {
  const sourceKey = useClientSummarySourceKey();
  const store = getSessionInteractionStore(sourceKey);
  const raw = useSyncExternalStore(store.subscribe, store.read, store.read);
  return useMemo(() => {
    const interactions = new Map<string, number>(JSON.parse(raw));
    // This browser's own record of where the reader has been, and the server's
    // record of when anyone last wrote into the session. The local one alone
    // would place a session by when *this* browser last visited it, so a phone
    // and a desktop disagreed about the same session and one of them filed a
    // session the reader had answered elsewhere under older work, where it was
    // hard to find. Taking the later of the two keeps a click's effect
    // immediate while letting a fresh browser, with nothing stored, still land
    // on the same chronology.
    const time = (record: SessionCollectionRecord) =>
      Math.max(
        interactions.get(record.id) ?? 0,
        Date.parse(record.lastHumanTurnAt ?? "") || 0,
        // Nothing has been written into it yet, or the provider does not report
        // it: fall back to when the session appeared.
        Date.parse(record.createdAt ?? "") || 0,
      );
    const order = (rows: readonly SessionCollectionRecord[]) =>
      [...rows].sort((a, b) => time(b) - time(a) || a.id.localeCompare(b.id));
    const cutoff = Date.now() - 24 * 60 * 60 * 1000;
    const ordinary = records.filter(
      (record) => !record.isStarred && !record.isArchived,
    );
    return {
      starred: order(starred),
      recent: order(ordinary.filter((record) => time(record) >= cutoff)),
      older: order(ordinary.filter((record) => time(record) < cutoff)),
    };
  }, [raw, records, starred]);
}

const SECTIONS = [
  "starred",
  "recent",
  "hiddenRecent",
  "older",
  "hiddenOlder",
] as const;
type SidebarLists<T> = Record<(typeof SECTIONS)[number], readonly T[]>;

/** Hold layout identities, while resolving every row from current live data. */
export function useHeldSidebarLists<T extends { id: string }>(
  lists: SidebarLists<T>,
  enabled: boolean,
) {
  const sourceKey = useClientSummarySourceKey();
  const pointer = useRef(false);
  const focused = useRef(false);
  const touch = useRef(false);
  const [held, setHeld] = useState<{
    sourceKey: string;
    lists: SidebarLists<T>;
  } | null>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: Source and enabled changes intentionally release the hold; the reset body does not need their values.
  useEffect(() => {
    pointer.current = false;
    focused.current = false;
    touch.current = false;
    setHeld(null);
  }, [sourceKey, enabled]);
  const hold = () => {
    if (!enabled) return;
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
  const visible = { ...lists };
  for (const key of SECTIONS) {
    visible[key] = held.lists[key].flatMap(({ id }) => {
      const row = current.get(id);
      return row ? [row] : [];
    });
  }
  return { lists: visible, handlers };
}
