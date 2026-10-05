import { useSyncExternalStore } from "react";
import {
  createLocalStorageValue,
  type LocalStorageValueStore,
} from "./localStorageValue";

const stores = new Map<string, LocalStorageValueStore<string>>();

function sessionLastFileStore(
  sessionId: string,
): LocalStorageValueStore<string> {
  let store = stores.get(sessionId);
  if (!store) {
    store = createLocalStorageValue(
      `yep-anywhere-session-last-file:${sessionId}`,
      "",
      (raw) => raw,
    );
    stores.set(sessionId, store);
  }
  return store;
}

/** Only a project file route survives Close and reload; no mounted viewer state. */
export function rememberSessionLastFile(
  sessionId: string,
  route: string,
): void {
  sessionLastFileStore(sessionId).set(route);
}

export function useSessionLastFile(sessionId: string): string {
  const store = sessionLastFileStore(sessionId);
  return useSyncExternalStore(store.subscribe, store.read, () => "");
}
