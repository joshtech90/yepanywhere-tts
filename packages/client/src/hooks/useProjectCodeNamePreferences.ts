import { useSyncExternalStore } from "react";
import {
  createLocalStorageBoolean,
  createLocalStorageValue,
} from "../lib/localStorageValue";
import { UI_KEYS } from "../lib/storageKeys";
import { isLimitedPrincipal, useActingPrincipal } from "./useActingPrincipal";

export interface ProjectCodeNamePreferences {
  enabled: boolean;
  activityPulseEnabled: boolean;
}

export const DEFAULT_PROJECT_CODE_NAME_PREFERENCES: ProjectCodeNamePreferences =
  {
    enabled: false,
    activityPulseEnabled: false,
  };

/**
 * The reader's explicit choice, or "unset" when they never made one. Stored as
 * the same "true"/"false" text the plain boolean store wrote, so an earlier
 * choice keeps its meaning.
 */
type CodeNameChoice = "on" | "off" | "unset";

const enabledStore = createLocalStorageValue<CodeNameChoice>(
  UI_KEYS.projectCodeNamesEnabled,
  "unset",
  (raw) => (raw === "true" ? "on" : "off"),
  (choice) => String(choice === "on"),
);
const activityPulseStore = createLocalStorageBoolean(
  UI_KEYS.projectCodeNameActivityPulseEnabled,
  DEFAULT_PROJECT_CODE_NAME_PREFERENCES.activityPulseEnabled,
);

const setProjectCodeNamesEnabled = (enabled: boolean) =>
  enabledStore.set(enabled ? "on" : "off");

/** Stored preferences alone; an unset code-name choice reads as off. */
export function getProjectCodeNamePreferences(): ProjectCodeNamePreferences {
  return {
    enabled: enabledStore.read() === "on",
    activityPulseEnabled: activityPulseStore.read(),
  };
}

/**
 * Code names default on for a limited user, whose projects otherwise read as
 * long `owner/name` paths, and off for the superuser. An explicit choice in
 * either direction wins.
 */
export function useProjectCodeNamePreferences() {
  const choice = useSyncExternalStore(
    enabledStore.subscribe,
    enabledStore.read,
    enabledStore.read,
  );
  const { principal } = useActingPrincipal();
  const projectCodeNamesEnabled =
    choice === "unset" ? isLimitedPrincipal(principal) : choice === "on";
  const projectCodeNameActivityPulseEnabled = useSyncExternalStore(
    activityPulseStore.subscribe,
    activityPulseStore.read,
    activityPulseStore.read,
  );

  return {
    projectCodeNamesEnabled,
    setProjectCodeNamesEnabled,
    projectCodeNameActivityPulseEnabled,
    setProjectCodeNameActivityPulseEnabled: activityPulseStore.set,
  };
}
