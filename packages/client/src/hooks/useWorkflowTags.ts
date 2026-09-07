import { useSyncExternalStore } from "react";
import { createLocalStorageBoolean } from "../lib/localStorageValue";
import { UI_KEYS } from "../lib/storageKeys";

const store = createLocalStorageBoolean(UI_KEYS.workflowTags, false);

export function useWorkflowTags() {
  const workflowTagsEnabled = useSyncExternalStore(
    store.subscribe,
    store.read,
    store.read,
  );
  return { workflowTagsEnabled, setWorkflowTagsEnabled: store.set };
}
