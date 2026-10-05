import { useSyncExternalStore } from "react";
import { createLocalStorageValue } from "../lib/localStorageValue";
import { UI_KEYS } from "../lib/storageKeys";

export const DEFAULT_SEARCH_CONCURRENCY = 4;
export const MAX_SEARCH_CONCURRENCY = 64;
const store = createLocalStorageValue(
  UI_KEYS.searchConcurrency,
  DEFAULT_SEARCH_CONCURRENCY,
  (raw) => {
    const value = Number(raw);
    return Number.isInteger(value) &&
      value >= 1 &&
      value <= MAX_SEARCH_CONCURRENCY
      ? value
      : undefined;
  },
);

export function useSearchConcurrency() {
  const searchConcurrency = useSyncExternalStore(
    store.subscribe,
    store.read,
    store.read,
  );
  return { searchConcurrency, setSearchConcurrency: store.set };
}
