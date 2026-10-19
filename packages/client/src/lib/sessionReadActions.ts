import { api } from "../api/client";

type ManualReadListener = (
  sessionId: string,
  unread: boolean,
) => { pending: Promise<unknown>; rollback: () => void } | undefined;

// Only mounted engagement trackers register; unmount releases each listener.
const manualReadListeners = new Set<ManualReadListener>();
// Entries exist only while an explicit write is pending, never as a cache.
const pendingWrites = new Map<string, Promise<unknown>>();

export function onManualSessionRead(listener: ManualReadListener) {
  manualReadListeners.add(listener);
  return () => {
    manualReadListeners.delete(listener);
  };
}

export async function setSessionUnread(sessionId: string, unread: boolean) {
  // Cancel queued automatic reads synchronously, then let any request already
  // sent finish before the explicit action becomes the final server write.
  const guards = [...manualReadListeners]
    .map((listener) => listener(sessionId, unread))
    .filter((guard) => guard !== undefined);
  const drained = Promise.all(guards.map((guard) => guard.pending));
  const previous = pendingWrites.get(sessionId);
  const write = (async () => {
    await previous?.catch(() => {});
    await drained;
    return unread
      ? api.markSessionUnread(sessionId)
      : api.markSessionSeen(sessionId);
  })();
  pendingWrites.set(sessionId, write);
  try {
    return await write;
  } catch (error) {
    for (const guard of guards) guard.rollback();
    throw error;
  } finally {
    if (pendingWrites.get(sessionId) === write) pendingWrites.delete(sessionId);
  }
}

export function sessionReadShortcut(event: {
  key: string;
  defaultPrevented: boolean;
  isComposing: boolean;
  repeat: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  target: EventTarget | null;
}): boolean | null {
  if (
    event.defaultPrevented ||
    event.isComposing ||
    event.repeat ||
    event.ctrlKey ||
    event.metaKey ||
    event.altKey ||
    event.shiftKey ||
    (event.key !== "r" && event.key !== "u")
  ) {
    return null;
  }
  const target = event.target;
  if (
    !(target instanceof Element) ||
    target.closest(
      'input, textarea, select, button, summary, [contenteditable]:not([contenteditable="false"]), [role="textbox"], [role="combobox"], [data-session-read-exclude]',
    ) ||
    document.querySelector(
      '[role="dialog"], dialog[open], [role="menu"], [data-session-menu-open]',
    )
  ) {
    return null;
  }
  return event.key === "u";
}
