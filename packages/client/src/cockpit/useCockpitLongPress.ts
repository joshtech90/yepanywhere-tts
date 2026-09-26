import {
  type MouseEvent,
  type PointerEvent,
  useCallback,
  useEffect,
  useRef,
} from "react";

export interface LongPressPoint {
  x: number;
  y: number;
}

export interface CockpitLongPressHandlers {
  onPointerDown: (event: PointerEvent) => void;
  onPointerMove: (event: PointerEvent) => void;
  onPointerUp: (event: PointerEvent) => void;
  onPointerCancel: (event: PointerEvent) => void;
  onPointerLeave: (event: PointerEvent) => void;
  onClickCapture: (event: MouseEvent) => void;
}

export function useCockpitLongPress(
  onLongPress: (point: LongPressPoint) => void,
  delayMs = 500,
): CockpitLongPressHandlers {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const startPointRef = useRef<LongPressPoint | null>(null);
  const shouldSwallowClickRef = useRef(false);
  const onLongPressRef = useRef(onLongPress);
  onLongPressRef.current = onLongPress;

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  // Clean timers on component unmount
  useEffect(() => {
    return () => {
      clearTimer();
    };
  }, [clearTimer]);

  const onPointerDown = useCallback(
    (event: PointerEvent) => {
      // Only touch and pen pointers trigger long press gestures
      if (event.pointerType !== "touch" && event.pointerType !== "pen") {
        return;
      }
      clearTimer();
      shouldSwallowClickRef.current = false;
      const point = { x: event.clientX, y: event.clientY };
      startPointRef.current = point;

      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        shouldSwallowClickRef.current = true;
        try {
          navigator.vibrate?.(10);
        } catch {
          // Ignore vibration failures if unsupported or blocked by browser permissions
        }
        onLongPressRef.current(point);
      }, delayMs);
    },
    [clearTimer, delayMs],
  );

  const onPointerMove = useCallback(
    (event: PointerEvent) => {
      if (timerRef.current === null || startPointRef.current === null) {
        return;
      }
      const dx = event.clientX - startPointRef.current.x;
      const dy = event.clientY - startPointRef.current.y;
      // Cancel gesture if touch movement exceeds 10px threshold
      if (Math.hypot(dx, dy) > 10) {
        clearTimer();
        startPointRef.current = null;
      }
    },
    [clearTimer],
  );

  const onPointerUp = useCallback(() => {
    clearTimer();
    startPointRef.current = null;
  }, [clearTimer]);

  const onPointerCancel = useCallback(() => {
    clearTimer();
    startPointRef.current = null;
  }, [clearTimer]);

  const onPointerLeave = useCallback(() => {
    clearTimer();
    startPointRef.current = null;
  }, [clearTimer]);

  const onClickCapture = useCallback((event: MouseEvent) => {
    // Swallow the following click so row link does not navigate after long press
    if (shouldSwallowClickRef.current) {
      shouldSwallowClickRef.current = false;
      event.preventDefault();
      event.stopPropagation();
    }
  }, []);

  return {
    onPointerDown,
    onPointerMove,
    onPointerUp,
    onPointerCancel,
    onPointerLeave,
    onClickCapture,
  };
}
