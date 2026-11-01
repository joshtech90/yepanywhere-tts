import { useMemo, useSyncExternalStore } from "react";
import { useClientSummarySourceKey } from "../lib/clientSummarySourceKey";
import {
  createLocalStorageValue,
  type LocalStorageValueStore,
} from "../lib/localStorageValue";

export type InboxCreationFilter = "all" | "ui" | "api" | "unspecified";

const stores = new Map<string, LocalStorageValueStore<InboxCreationFilter>>();

function filterStore(sourceKey: string) {
  let store = stores.get(sourceKey);
  if (!store) {
    store = createLocalStorageValue<InboxCreationFilter>(
      `yep-anywhere-inbox-created-via:${encodeURIComponent(sourceKey)}`,
      "all",
      (raw) => {
        switch (raw) {
          case "all":
          case "ui":
          case "api":
          case "unspecified":
            return raw;
          default:
            return undefined;
        }
      },
    );
    stores.set(sourceKey, store);
  }
  return store;
}

/** Remember the Inbox's creation filter separately for each server source. */
export function useInboxCreationFilter() {
  const sourceKey = useClientSummarySourceKey();
  const store = useMemo(() => filterStore(sourceKey), [sourceKey]);
  const filter = useSyncExternalStore(store.subscribe, store.read, store.read);
  return [filter, store.set] as const;
}
