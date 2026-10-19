import { useSyncExternalStore } from "react";
import { createLocalStorageBoolean } from "../lib/localStorageValue";
import { UI_KEYS } from "../lib/storageKeys";

/** Browser-local opt-out for Escape interrupting the active turn. */
export const escapeInterruptDisabledSetting = createLocalStorageBoolean(
  UI_KEYS.escapeInterruptDisabled,
  false,
);

export function useEscapeInterruptDisabled() {
  const escapeInterruptDisabled = useSyncExternalStore(
    escapeInterruptDisabledSetting.subscribe,
    escapeInterruptDisabledSetting.read,
    escapeInterruptDisabledSetting.read,
  );
  return {
    escapeInterruptDisabled,
    setEscapeInterruptDisabled: escapeInterruptDisabledSetting.set,
  };
}
