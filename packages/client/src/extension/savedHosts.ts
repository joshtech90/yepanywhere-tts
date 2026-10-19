/**
 * Saved hosts across the extension's contexts (docs/tactical/151 step 7).
 *
 * Pages keep the saved-host record in `localStorage`, where the credential
 * compare-and-set and Web Locks coordination already live. Each extension
 * page mirrors that record into `chrome.storage.local` after every write, and
 * the background worker, which has no `localStorage`, reads the mirror. The
 * worker never writes credentials: a resume keeps the same session, and the
 * page's record stays the one source of truth.
 */

import type { HostCredentialAttempt, SavedHost } from "../lib/hostStorage";
import { loadSavedHosts } from "../lib/hostStorage";
import { scopeForHost } from "../lib/rejectedResumeStorage";
import type { SavedHostCredentials } from "../lib/savedHostConnection";
import { onSavedHostsWritten } from "../lib/savedHostsWritten";
import { getChrome } from "./chrome";
import type { ExtensionSettings } from "./settings";

export const SAVED_HOSTS_MIRROR_KEY = "ya.savedHosts";

/** Copy this page's saved hosts to the mirror now and after each write. */
export function installSavedHostsMirror(): () => void {
  const chrome = getChrome();
  if (!chrome) return () => {};
  const mirror = () => {
    void chrome.storage.local
      .set({ [SAVED_HOSTS_MIRROR_KEY]: loadSavedHosts().hosts })
      .catch(() => {});
  };
  mirror();
  const unsubscribe = onSavedHostsWritten(mirror);
  // Another extension tab's write reaches this page as a storage event; the
  // writer mirrors it, so this page needs no action.
  return unsubscribe;
}

/** The mirrored hosts, for a context without `localStorage`. */
export async function loadMirroredHosts(): Promise<SavedHost[]> {
  const chrome = getChrome();
  if (!chrome) return [];
  const stored = await chrome.storage.local.get(SAVED_HOSTS_MIRROR_KEY);
  const hosts = stored[SAVED_HOSTS_MIRROR_KEY];
  return Array.isArray(hosts) ? (hosts as SavedHost[]) : [];
}

/** Saved hosts in the current context: the page record, else the mirror. */
export async function loadContextHosts(): Promise<SavedHost[]> {
  return typeof localStorage === "undefined"
    ? loadMirroredHosts()
    : loadSavedHosts().hosts;
}

/** Relay hosts the extension uses outside the YA tab, in saved order. */
export function activeHosts(
  hosts: SavedHost[],
  settings: Pick<ExtensionSettings, "activeHostIds">,
): SavedHost[] {
  const relay = hosts.filter(
    (host) => host.mode === "relay" && host.relayUsername && host.relayUrl,
  );
  return settings.activeHostIds === null
    ? relay
    : relay.filter((host) => settings.activeHostIds?.includes(host.id));
}

export function defaultHost(
  hosts: SavedHost[],
  settings: Pick<ExtensionSettings, "activeHostIds" | "defaultHostId">,
): SavedHost | undefined {
  const active = activeHosts(hosts, settings);
  return active.find((host) => host.id === settings.defaultHostId) ?? active[0];
}

/**
 * Read-only credentials for the background worker: claim the mirrored
 * session and never record one. A refreshed session is the page's to store.
 */
export const mirroredHostCredentials: SavedHostCredentials = {
  begin: async (host, session): Promise<HostCredentialAttempt> => ({
    hostId: host.id,
    scope: scopeForHost(host),
    revision: host.credentialRevision ?? "",
    sessionId: session.sessionId,
    previousSessionId: session.sessionId,
  }),
  isCurrent: () => true,
  commit: async () => {},
};
