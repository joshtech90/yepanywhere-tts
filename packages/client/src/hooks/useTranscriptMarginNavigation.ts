import { useSyncExternalStore } from "react";
import { createLocalStorageBoolean } from "../lib/localStorageValue";
import { UI_KEYS } from "../lib/storageKeys";

/**
 * Transcript margin navigation preference: clicking a row's margin steps the
 * transcript outline. Browser-local and off by default, because it takes
 * over plain clicks and the browser context menu on row margins.
 */
export const transcriptMarginNavigationSetting = createLocalStorageBoolean(
  UI_KEYS.transcriptMarginNavigation,
  false,
);

export function useTranscriptMarginNavigation() {
  const transcriptMarginNavigationEnabled = useSyncExternalStore(
    transcriptMarginNavigationSetting.subscribe,
    transcriptMarginNavigationSetting.read,
    transcriptMarginNavigationSetting.read,
  );
  return {
    transcriptMarginNavigationEnabled,
    setTranscriptMarginNavigationEnabled: transcriptMarginNavigationSetting.set,
  };
}
