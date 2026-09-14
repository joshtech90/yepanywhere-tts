import { useSyncExternalStore } from "react";
import { createLocalStorageBoolean } from "../lib/localStorageValue";
import { UI_KEYS } from "../lib/storageKeys";

const store = createLocalStorageBoolean(UI_KEYS.acliCommentary, true);

export function useAcliCommentarySetting() {
  const acliCommentaryEnabled = useSyncExternalStore(
    store.subscribe,
    store.read,
    store.read,
  );
  return { acliCommentaryEnabled, setAcliCommentaryEnabled: store.set };
}
