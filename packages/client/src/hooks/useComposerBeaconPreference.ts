import { useSyncExternalStore } from "react";
import { createLocalStorageBoolean } from "../lib/localStorageValue";
import { UI_KEYS } from "../lib/storageKeys";

const store = createLocalStorageBoolean(UI_KEYS.composerBeaconEnabled, true);

export function useComposerBeaconPreference() {
  const composerBeaconEnabled = useSyncExternalStore(
    store.subscribe,
    store.read,
    store.read,
  );
  return { composerBeaconEnabled, setComposerBeaconEnabled: store.set };
}
