import type {
  BrowserSettingsBackup,
  BrowserSettingsBackupValues,
} from "@yep-anywhere/shared";
import { BROWSER_SETTINGS_BACKUP_KEYS } from "./browserSettingsBackup";

/**
 * Browser defaults the superuser publishes to limited users
 * (topics/limited-users.md § Browser defaults for limited users).
 *
 * Each published revision is applied once per browser, server and account:
 * listed keys overwrite this browser's values, unlisted keys are untouched,
 * and later local changes stand until the superuser publishes again.
 */

const PORTABLE_KEYS: ReadonlySet<string> = new Set(
  BROWSER_SETTINGS_BACKUP_KEYS,
);

const APPLIED_REVISION_PREFIX = "yep-anywhere-limited-user-defaults-applied:";

/** Keep only portable preferences; never credentials, drafts or identity. */
export function portableBrowserSettings(
  values: BrowserSettingsBackupValues,
): BrowserSettingsBackupValues {
  return Object.fromEntries(
    Object.entries(values).filter(([key]) => PORTABLE_KEYS.has(key)),
  );
}

/**
 * Apply a published revision unless this account already took it. Returns
 * whether any stored value changed, which is when the page must reload to
 * pick the new values up. A storage failure restores the prior values and
 * leaves the revision unapplied, so the next load retries.
 */
export function applyLimitedUserBrowserDefaults(
  defaults: BrowserSettingsBackup,
  account: string,
  storage: Pick<
    Storage,
    "getItem" | "setItem" | "removeItem"
  > = window.localStorage,
): boolean {
  const markerKey = `${APPLIED_REVISION_PREFIX}${account}`;
  if (storage.getItem(markerKey) === defaults.savedAt) return false;
  const values = portableBrowserSettings(defaults.values);
  const previous = new Map(
    Object.keys(values).map((key) => [key, storage.getItem(key)]),
  );
  let changed = false;
  try {
    for (const [key, value] of Object.entries(values)) {
      if (previous.get(key) === value) continue;
      storage.setItem(key, value);
      changed = true;
    }
    storage.setItem(markerKey, defaults.savedAt);
  } catch (error) {
    for (const [key, value] of previous) {
      if (value === null) storage.removeItem(key);
      else storage.setItem(key, value);
    }
    throw error;
  }
  return changed;
}
