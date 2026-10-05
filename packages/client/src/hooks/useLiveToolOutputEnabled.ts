import { useSyncExternalStore } from "react";
import { createLocalStorageBoolean } from "../lib/localStorageValue";
import { UI_KEYS } from "../lib/storageKeys";

const store = createLocalStorageBoolean(UI_KEYS.liveToolOutputEnabled, true);

export const subscribeLiveToolOutputEnabled = store.subscribe;

/**
 * Whether running commands show their output as it is printed. When off, the
 * server is asked not to send that output and the client drops any it still
 * receives; the completed result is shown either way.
 */
export function useLiveToolOutputEnabled() {
  const liveToolOutputEnabled = useSyncExternalStore(
    store.subscribe,
    store.read,
    store.read,
  );
  return { liveToolOutputEnabled, setLiveToolOutputEnabled: store.set };
}

/** The live command output preference outside React. */
export const getLiveToolOutputEnabled = store.read;
