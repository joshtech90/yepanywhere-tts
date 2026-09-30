import { useSyncExternalStore } from "react";
import { createLocalStorageBoolean } from "../lib/localStorageValue";
import { UI_KEYS } from "../lib/storageKeys";

/**
 * Recent-prompt dash rail beside the new-session and project-template
 * composers. Browser-local and off by default: the drag-to-insert rail is a
 * YA-novel interaction most users would not recognize.
 */
export const composerPromptRailSetting = createLocalStorageBoolean(
  UI_KEYS.composerPromptRail,
  false,
);

export function useComposerPromptRail() {
  const composerPromptRailEnabled = useSyncExternalStore(
    composerPromptRailSetting.subscribe,
    composerPromptRailSetting.read,
    composerPromptRailSetting.read,
  );
  return {
    composerPromptRailEnabled,
    setComposerPromptRailEnabled: composerPromptRailSetting.set,
  };
}
