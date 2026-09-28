import { createLocalStorageValue, getLocalStorage } from "./localStorageValue";

type Interaction = [sessionId: string, timestamp: number];
const LIMIT = 1000;
const stores = new Map<string, ReturnType<typeof createStore>>();

function createStore(sourceKey: string) {
  const source = encodeURIComponent(sourceKey);
  // This key also held session visits, which no longer order the sidebar; a
  // visit kept there would pin its row until something newer was written.
  try {
    getLocalStorage()?.removeItem(`yep-sidebar-interactions:${source}`);
  } catch {
    // Storage is unavailable, so there is nothing to discard.
  }
  return createLocalStorageValue(
    `yep-sidebar-submissions:${source}`,
    "[]",
    (raw) => {
      try {
        const entries: unknown = JSON.parse(raw);
        return Array.isArray(entries) &&
          entries.length <= LIMIT &&
          entries.every(
            (entry) =>
              Array.isArray(entry) &&
              entry.length === 2 &&
              typeof entry[0] === "string" &&
              typeof entry[1] === "number" &&
              Number.isFinite(entry[1]),
          )
          ? raw
          : undefined;
      } catch {
        return undefined;
      }
    },
  );
}

export function getSessionInteractionStore(sourceKey: string) {
  let store = stores.get(sourceKey);
  if (!store) {
    store = createStore(sourceKey);
    stores.set(sourceKey, store);
  }
  return store;
}

/** Only composer submission calls this: never navigation or feeds. */
export function recordSessionInteraction(
  sourceKey: string,
  sessionId: string,
  timestamp = Date.now(),
): void {
  const store = getSessionInteractionStore(sourceKey);
  const entries: Interaction[] = JSON.parse(store.read());
  const next: Interaction = [
    sessionId,
    Math.max(timestamp, (entries[0]?.[1] ?? 0) + 1),
  ];
  store.set(
    JSON.stringify(
      [next, ...entries.filter(([id]) => id !== sessionId)].slice(0, LIMIT),
    ),
  );
}
