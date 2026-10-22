import { useRef, type MouseEvent, type PointerEvent } from "react";
import type { DraftControls } from "./useDraftPersistence";

const INTERACTIVE =
  'a,button,input,textarea,select,summary,iframe,[contenteditable]:not([contenteditable="false"]),[role="button"],[role="menu"],[role="search"],[role="dialog"],[tabindex]';

/** A plain transcript click returns typing to the composer, without moving its caret. */
export function useTranscriptComposerFocus(
  enabled: boolean,
  controlsRef: { current: Pick<DraftControls, "focus"> | null },
) {
  const press = useRef<{ x: number; y: number } | null>(null);
  const blocked = (container: HTMLElement) =>
    !enabled ||
    document.querySelector(
      '[role="dialog"],dialog[open],[aria-modal="true"]',
    ) !== null ||
    container.querySelector('[role="search"]') !== null ||
    !window.getSelection()?.isCollapsed;
  const plainTarget = (target: EventTarget, container: HTMLElement) => {
    if (
      !(target instanceof Element) ||
      target === container ||
      !container.contains(target)
    )
      return false;
    const interactive = target.closest(INTERACTIVE);
    return interactive === null || interactive === container;
  };
  return {
    onPointerDownCapture(event: PointerEvent<HTMLElement>) {
      press.current = null;
      if (
        event.pointerType !== "mouse" ||
        event.button !== 0 ||
        event.ctrlKey ||
        event.altKey ||
        event.shiftKey ||
        event.metaKey ||
        blocked(event.currentTarget) ||
        !plainTarget(event.target, event.currentTarget)
      )
        return;
      press.current = { x: event.clientX, y: event.clientY };
    },
    onClick(event: MouseEvent<HTMLElement>) {
      const start = press.current;
      press.current = null;
      if (
        !start ||
        event.defaultPrevented ||
        event.detail !== 1 ||
        Math.hypot(event.clientX - start.x, event.clientY - start.y) >= 4 ||
        blocked(event.currentTarget) ||
        !plainTarget(event.target, event.currentTarget)
      )
        return;
      // A control that acquired focus during the gesture owns the keyboard.
      if (
        document.activeElement !== event.currentTarget &&
        document.activeElement !== document.body
      )
        return;
      controlsRef.current?.focus?.({ preventScroll: true });
    },
  };
}
