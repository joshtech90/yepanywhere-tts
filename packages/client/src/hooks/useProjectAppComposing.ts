import { useSyncExternalStore } from "react";
import { createLocalStorageBoolean } from "../lib/localStorageValue";
import { UI_KEYS } from "../lib/storageKeys";

/** Browser-local opt-in for the New Session project-app composing link. */
export const projectAppComposingSetting = createLocalStorageBoolean(
  UI_KEYS.projectAppComposing,
  false,
);

export function useProjectAppComposing() {
  const projectAppComposingEnabled = useSyncExternalStore(
    projectAppComposingSetting.subscribe,
    projectAppComposingSetting.read,
    projectAppComposingSetting.read,
  );
  return {
    projectAppComposingEnabled,
    setProjectAppComposingEnabled: projectAppComposingSetting.set,
  };
}
