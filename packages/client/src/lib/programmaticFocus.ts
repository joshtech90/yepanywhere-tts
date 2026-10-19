/**
 * Whether keyboard focus is inside an embedded frame, such as the project
 * App viewer. The parent document cannot see into a cross-origin frame, so
 * the frame element itself being the active element is the signal.
 */
export function embeddedFrameHoldsFocus(): boolean {
  return (
    typeof document !== "undefined" &&
    document.activeElement instanceof HTMLIFrameElement
  );
}

/**
 * Focus for a move YA makes on its own (after an await, a timer, a frame,
 * a voice event, or a surface that opened by itself), never from a user's
 * own YA click or key. Declines while an embedded app holds focus, so YA
 * never takes keys from the project App without a user action in YA
 * (topics/project-service.md § Project App and Settings).
 */
export function programmaticFocus(
  element: HTMLElement | null | undefined,
  options?: FocusOptions,
): void {
  if (!element || embeddedFrameHoldsFocus()) return;
  element.focus(options);
}
