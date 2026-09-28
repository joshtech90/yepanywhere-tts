import { useCallback, useSyncExternalStore } from "react";
import { getLocalStorage } from "./localStorageValue";
import type { SessionVhostApp } from "./sessionVhostApps";

export interface SessionApps {
  /**
   * The announcement id survives storage so a viewer-activated app (a play
   * grant, `play:` prefixed) can be seeded back into a reopened session's
   * app list, which transcript scanning alone would never rediscover.
   */
  latest?: SessionVhostApp & { announcementId?: string };
  dismissed: string[];
}

export const SESSION_APPS_KEY_PREFIX = "yep-anywhere-session-apps:";

const DEFAULT_APPS: SessionApps = { dismissed: [] };

/**
 * Canonical field order, so an unchanged value re-serializes byte-identically
 * and `writeSessionApps` can recognize it as nothing to record.
 */
function serialize(apps: SessionApps): string {
  return JSON.stringify({ latest: apps.latest, dismissed: apps.dismissed });
}

const DEFAULT_RAW = serialize(DEFAULT_APPS);

function parse(raw: string): SessionApps | undefined {
  try {
    const value = JSON.parse(raw);
    if (
      !Array.isArray(value.dismissed) ||
      !value.dismissed.every((id: unknown) => typeof id === "string")
    )
      return;
    if (
      value.latest &&
      ![value.latest.url, value.latest.sourceUrl, value.latest.label].every(
        (field) => typeof field === "string",
      )
    )
      return;
    return value;
  } catch {
    return;
  }
}

/**
 * One store for the whole `yep-anywhere-session-apps:` key family.
 *
 * Every reader shares this index and one storage observer, so a sidebar of any
 * length costs one subscription per mounted row rather than a per-session store
 * that outlives it. The index is the in-memory snapshot: a write updates it in
 * place so unrelated sessions keep their snapshot identity and do not re-render,
 * while a cross-tab storage event drops it for a rescan.
 */
let index: Map<string, SessionApps> | undefined;
const listeners = new Set<() => void>();
let observingStorage = false;

function scanStorage(): Map<string, SessionApps> | undefined {
  const entries = new Map<string, SessionApps>();
  const storage = getLocalStorage();
  if (!storage) {
    // No storage at all: an empty index still accepts this tab's writes.
    return entries;
  }
  try {
    for (let position = 0; position < storage.length; position += 1) {
      const storageKey = storage.key(position);
      if (!storageKey?.startsWith(SESSION_APPS_KEY_PREFIX)) continue;
      const raw = storage.getItem(storageKey);
      const apps = raw === null ? undefined : parse(raw);
      if (apps)
        entries.set(storageKey.slice(SESSION_APPS_KEY_PREFIX.length), apps);
    }
  } catch {
    // Storage is present but unreadable; leave the index unbuilt so a later
    // read retries rather than caching an empty answer.
    return;
  }
  return entries;
}

function readIndex(): Map<string, SessionApps> {
  if (!index) index = scanStorage();
  return index ?? new Map();
}

function notify(): void {
  for (const listener of listeners) {
    listener();
  }
}

function observeStorage(): void {
  if (observingStorage || typeof window === "undefined") return;
  observingStorage = true;
  window.addEventListener("storage", (event) => {
    if (event.key === null || event.key.startsWith(SESSION_APPS_KEY_PREFIX)) {
      index = undefined;
      notify();
    }
  });
}

function subscribe(listener: () => void): () => void {
  observeStorage();
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function readSessionApps(key: string): SessionApps {
  return readIndex().get(key) ?? DEFAULT_APPS;
}

/**
 * Discard the cached index after a raw storage write this store did not make.
 * Same-tab writes from outside the app (an import, a test, DevTools) are not
 * discovered by an unrelated render, exactly as for a single-key preference.
 */
export function invalidateSessionApps(): void {
  index = undefined;
  notify();
}

/**
 * Persist one session's apps, writing only what differs from what is stored.
 *
 * A session with nothing to remember owns no key: the default value removes an
 * existing key and never creates one, so ordinary sessions leave browser
 * storage untouched.
 */
export function writeSessionApps(key: string, apps: SessionApps): void {
  const storageKey = `${SESSION_APPS_KEY_PREFIX}${key}`;
  const raw = serialize(apps);
  const storage = getLocalStorage();
  let stored: string | null | undefined;
  try {
    stored = storage ? storage.getItem(storageKey) : null;
  } catch {
    stored = undefined;
  }
  if (raw === DEFAULT_RAW ? stored === null : stored === raw) return;
  try {
    if (raw === DEFAULT_RAW) storage?.removeItem(storageKey);
    else storage?.setItem(storageKey, raw);
  } catch {
    // Persistence failed; the in-memory index below still serves this tab.
  }
  const entries = readIndex();
  if (raw === DEFAULT_RAW) entries.delete(key);
  else entries.set(key, apps);
  index = entries;
  notify();
}

/**
 * Stop offering the named announcements for this session, permanently.
 *
 * Dismissal reads what is stored rather than a caller's snapshot, so a stale
 * render cannot resurrect an announcement dismissed since. The session keeps no
 * latest app afterwards: everything it had to offer has just been dismissed.
 */
export function dismissSessionApps(
  key: string,
  announcementIds: readonly string[],
): void {
  const stored = readSessionApps(key);
  writeSessionApps(key, {
    dismissed: [...new Set([...stored.dismissed, ...announcementIds])],
  });
}

export function useSessionApps(key: string): {
  value: SessionApps;
  saveLatest: (latest: SessionApps["latest"]) => void;
  dismiss: (announcementIds: readonly string[]) => void;
} {
  const read = useCallback(() => readSessionApps(key), [key]);
  const value = useSyncExternalStore(subscribe, read, read);
  const saveLatest = useCallback(
    (latest: SessionApps["latest"]) =>
      writeSessionApps(key, { ...readSessionApps(key), latest }),
    [key],
  );
  const dismiss = useCallback(
    (announcementIds: readonly string[]) =>
      dismissSessionApps(key, announcementIds),
    [key],
  );
  return { value, saveLatest, dismiss };
}

/**
 * Whether a session has a discovered app, for list rows that only show a chip.
 * A boolean snapshot keeps another session's write from re-rendering the row.
 */
export function useSessionHasApp(key: string): boolean {
  const read = useCallback(
    () => readSessionApps(key).latest !== undefined,
    [key],
  );
  return useSyncExternalStore(subscribe, read, read);
}
