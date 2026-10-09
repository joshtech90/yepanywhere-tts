import { useCallback, useEffect, useRef } from "react";

const LONG_PRESS_MS = 500;
/** Movement beyond this is a scroll or drag, not a held press. */
const MOVE_TOLERANCE_PX = 10;

/**
 * A press held for half a second, or a right-click, runs `onLongPress`; the
 * click that ends a long press is swallowed so the ordinary action does not
 * also fire. Spread the returned handlers on the element and route its
 * onClick through `click`.
 */
export function useLongPress(onLongPress: () => void) {
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const start = useRef<{ x: number; y: number } | null>(null);
  const fired = useRef(false);
  // The current press already ran the callback from its timer.
  const held = useRef(false);
  const callback = useRef(onLongPress);
  callback.current = onLongPress;
  useEffect(() => () => clearTimeout(timer.current), []);

  const cancel = useCallback(() => {
    clearTimeout(timer.current);
    start.current = null;
  }, []);

  return {
    handlers: {
      onPointerDown: (event: React.PointerEvent) => {
        held.current = false;
        // Secondary buttons arrive as contextmenu below.
        if (event.button > 0) return;
        fired.current = false;
        start.current = { x: event.clientX, y: event.clientY };
        clearTimeout(timer.current);
        timer.current = setTimeout(() => {
          fired.current = true;
          held.current = true;
          start.current = null;
          callback.current();
        }, LONG_PRESS_MS);
      },
      onPointerMove: (event: React.PointerEvent) => {
        const origin = start.current;
        if (
          origin &&
          Math.hypot(event.clientX - origin.x, event.clientY - origin.y) >
            MOVE_TOLERANCE_PX
        )
          cancel();
      },
      onPointerUp: cancel,
      onPointerLeave: cancel,
      onPointerCancel: cancel,
      onContextMenu: (event: React.MouseEvent) => {
        // A touch long press also raises contextmenu; either way it is ours.
        // Only the press whose timer already ran is skipped, so a repeated
        // right-click opens again even though no click cleared `fired`.
        event.preventDefault();
        if (held.current) {
          held.current = false;
          return;
        }
        cancel();
        fired.current = true;
        callback.current();
      },
    },
    /** Wrap the element's click: false when a long press just happened. */
    click: (action: () => void) => () => {
      if (fired.current) {
        fired.current = false;
        return;
      }
      action();
    },
  };
}
