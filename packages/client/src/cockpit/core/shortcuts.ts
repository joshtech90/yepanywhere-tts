export type CockpitShortcutAction =
  | "composer"
  | "help"
  | "navigation-prefix"
  | "new-session"
  | "projects"
  | "search"
  | "sessions"
  | "stop";

export interface CockpitShortcutKey {
  altKey: boolean;
  ctrlKey: boolean;
  defaultPrevented: boolean;
  isComposing: boolean;
  key: string;
  metaKey: boolean;
  repeat: boolean;
  shiftKey: boolean;
  target: EventTarget | null;
}

export interface CockpitLocalKeyEvent {
  key: string;
  preventDefault: () => void;
  stopPropagation: () => void;
}

export function containCockpitLocalEscape(
  event: CockpitLocalKeyEvent,
): boolean {
  if (event.key !== "Escape") return false;
  event.preventDefault();
  event.stopPropagation();
  return true;
}

export function isCockpitTextEditingTarget(
  target: EventTarget | null,
): boolean {
  if (!(target instanceof Element)) return false;
  const editable = target.closest(
    'input, textarea, select, [contenteditable]:not([contenteditable="false"])',
  );
  return editable !== null;
}

export function resolveCockpitShortcut(
  event: CockpitShortcutKey,
  navigationPrefixPending: boolean,
): CockpitShortcutAction | null {
  if (
    event.defaultPrevented ||
    event.isComposing ||
    event.repeat ||
    event.altKey ||
    event.ctrlKey ||
    event.metaKey
  ) {
    return null;
  }

  const key = event.key.toLowerCase();
  const editing = isCockpitTextEditingTarget(event.target);
  if (editing) return key === "escape" ? "stop" : null;

  if (key === "escape") return "stop";
  if (event.key === "?") return "help";
  if (navigationPrefixPending) {
    if (key === "s") return "sessions";
    if (key === "p") return "projects";
    return null;
  }
  if (event.key === "/") return "search";
  if (key === "n") return "new-session";
  if (key === "r") return "composer";
  if (key === "g") return "navigation-prefix";
  return null;
}
