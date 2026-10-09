import {
  getSessionViewerSnapshot,
  subscribeSessionViewer,
} from "./sessionViewerController";

/**
 * The session file viewer that a reload of this tab reopens.
 *
 * Tab-scoped (sessionStorage): a reload or a hot update keeps the reader's
 * place, while a new tab or a later visit starts with no viewer open. Close
 * removes the record; minimizing and scrolling update it.
 */
export interface ReloadedSessionFile {
  /** Project file-view route, as remembered for the last file. */
  route: string;
  minimized: boolean;
  /** The viewer body's scroll offset, once the reader has scrolled. */
  scrollTop?: number;
}

const KEY_PREFIX = "yep-anywhere-session-open-file:";

/** Viewer ids this tab opened from a project file route, by session. */
const hotData: { tracked?: Map<string, string> } | undefined = import.meta.hot
  ?.data;
const tracked = hotData?.tracked ?? new Map<string, string>();
if (hotData) hotData.tracked = tracked;

function storageKey(sessionId: string): string {
  return `${KEY_PREFIX}${sessionId}`;
}

export function readReloadedSessionFile(
  sessionId: string,
): ReloadedSessionFile | null {
  try {
    const raw = sessionStorage.getItem(storageKey(sessionId));
    if (!raw) return null;
    const value = JSON.parse(raw) as Partial<ReloadedSessionFile>;
    if (typeof value.route !== "string" || !value.route) return null;
    return {
      route: value.route,
      minimized: value.minimized === true,
      scrollTop:
        typeof value.scrollTop === "number" && value.scrollTop >= 0
          ? value.scrollTop
          : undefined,
    };
  } catch {
    return null;
  }
}

function write(sessionId: string, value: ReloadedSessionFile | null): void {
  try {
    if (value)
      sessionStorage.setItem(storageKey(sessionId), JSON.stringify(value));
    else sessionStorage.removeItem(storageKey(sessionId));
  } catch {
    // Without storage a reload simply opens no viewer, as before.
  }
}

/**
 * Record that `viewerId` shows `route` for the session. A record of the same
 * route survives: it is the one a reload is restoring, or this viewer's own
 * from before its content remounted. Opening a file over a tracked viewer
 * has already dropped that viewer's record.
 */
export function trackReloadedSessionFile(
  sessionId: string,
  viewerId: string,
  route: string,
): void {
  const previous = readReloadedSessionFile(sessionId);
  tracked.set(sessionId, viewerId);
  write(
    sessionId,
    previous?.route === route ? previous : { route, minimized: false },
  );
}

export function saveReloadedSessionFileScroll(
  sessionId: string,
  viewerId: string,
  scrollTop: number,
): void {
  if (tracked.get(sessionId) !== viewerId) return;
  const previous = readReloadedSessionFile(sessionId);
  if (!previous || previous.scrollTop === scrollTop) return;
  write(sessionId, { ...previous, scrollTop });
}

// Follow the managed viewer: minimizing is remembered, and a tracked viewer
// that stops being current was closed or replaced, so a reload must not
// bring it back. Unloading the page changes nothing here, which is what
// lets the record outlive a reload.
const unsubscribe = subscribeSessionViewer(() => {
  const current = getSessionViewerSnapshot();
  for (const [sessionId, viewerId] of tracked) {
    if (current?.id === viewerId) {
      const previous = readReloadedSessionFile(sessionId);
      if (previous && previous.minimized !== current.minimized)
        write(sessionId, { ...previous, minimized: current.minimized });
      continue;
    }
    tracked.delete(sessionId);
    write(sessionId, null);
  }
});
import.meta.hot?.dispose(unsubscribe);
