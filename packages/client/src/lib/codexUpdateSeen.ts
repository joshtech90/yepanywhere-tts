const CODEX_UPDATE_SEEN_KEY = "codex-update-seen-tag";

export function readSeenCodexUpdateTag(): string | null {
  try {
    return window.localStorage.getItem(CODEX_UPDATE_SEEN_KEY);
  } catch {
    return null;
  }
}

export function writeSeenCodexUpdateTag(tag: string): void {
  try {
    window.localStorage.setItem(CODEX_UPDATE_SEEN_KEY, tag);
  } catch {
    // Storage denied / full: the notice may reappear next session.
  }
}
