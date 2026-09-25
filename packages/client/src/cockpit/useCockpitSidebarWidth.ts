import {
  type CSSProperties,
  type KeyboardEvent,
  type MouseEvent,
  type PointerEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  clampCockpitSidebarWidth,
  clearCockpitSidebarWidth,
  COCKPIT_SIDEBAR_WIDTH_DEFAULT,
  COCKPIT_SIDEBAR_WIDTH_MAX,
  COCKPIT_SIDEBAR_WIDTH_MIN,
  nextCockpitSidebarWidthForKey,
  readCockpitSidebarWidth,
  saveCockpitSidebarWidth,
} from "./core/sidebarWidth";

export interface CockpitSidebarResizeHandleProps {
  role: "separator";
  tabIndex: 0;
  "aria-orientation": "vertical";
  "aria-valuenow": number;
  "aria-valuemin": number;
  "aria-valuemax": number;
  "aria-label": string;
  "data-resizing": "true" | "false";
  onPointerDown: (event: PointerEvent<HTMLElement>) => void;
  onPointerMove: (event: PointerEvent<HTMLElement>) => void;
  onPointerUp: (event: PointerEvent<HTMLElement>) => void;
  onPointerCancel: (event: PointerEvent<HTMLElement>) => void;
  onDoubleClick: (event: MouseEvent<HTMLElement>) => void;
  onKeyDown: (event: KeyboardEvent<HTMLElement>) => void;
}

export interface UseCockpitSidebarWidthResult {
  width: number;
  handleProps: CockpitSidebarResizeHandleProps | null;
  style: CSSProperties;
  resizing: boolean;
}

interface DragSession {
  pointerId: number;
  startX: number;
  startWidth: number;
  currentWidth: number;
}

function getSafeLocalStorage(): Storage | null {
  try {
    return typeof window !== "undefined" ? window.localStorage : null;
  } catch {
    return null;
  }
}

function getInitialWidth(): number {
  return readCockpitSidebarWidth(getSafeLocalStorage());
}

export function useCockpitSidebarWidth(
  enabled: boolean,
  label = "Resize sidebar",
): UseCockpitSidebarWidthResult {
  const [width, setWidth] = useState<number>(getInitialWidth);
  const [resizing, setResizing] = useState(false);

  const widthRef = useRef(width);
  widthRef.current = width;

  const dragRef = useRef<DragSession | null>(null);
  const rafIdRef = useRef<number | null>(null);
  const pendingWidthRef = useRef<number | null>(null);
  const prevBodyStyleRef = useRef<{
    userSelect: string;
    cursor: string;
  } | null>(null);

  const restoreBodyStyles = useCallback(() => {
    if (!prevBodyStyleRef.current) return;
    document.body.style.userSelect = prevBodyStyleRef.current.userSelect;
    document.body.style.cursor = prevBodyStyleRef.current.cursor;
    prevBodyStyleRef.current = null;
  }, []);

  const handlePointerDown = useCallback((event: PointerEvent<HTMLElement>) => {
    if (event.button !== 0) return;

    try {
      event.currentTarget.setPointerCapture?.(event.pointerId);
    } catch {
      // In non-browser test environments setPointerCapture may be unavailable.
    }

    prevBodyStyleRef.current = {
      userSelect: document.body.style.userSelect,
      cursor: document.body.style.cursor,
    };
    document.body.style.userSelect = "none";
    document.body.style.cursor = "col-resize";

    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startWidth: widthRef.current,
      currentWidth: widthRef.current,
    };
    setResizing(true);
  }, []);

  const handlePointerMove = useCallback((event: PointerEvent<HTMLElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;

    const dx = event.clientX - drag.startX;
    const viewportWidth =
      typeof window !== "undefined" ? window.innerWidth : undefined;
    const nextWidth = clampCockpitSidebarWidth(
      drag.startWidth + dx,
      viewportWidth,
    );

    drag.currentWidth = nextWidth;
    pendingWidthRef.current = nextWidth;

    if (rafIdRef.current === null && typeof window !== "undefined") {
      let synchronous = false;
      const frameId = window.requestAnimationFrame(() => {
        synchronous = true;
        rafIdRef.current = null;
        if (pendingWidthRef.current !== null) {
          setWidth(pendingWidthRef.current);
        }
      });
      // Handles both synchronous test mocks and asynchronous browser rAF calls.
      if (!synchronous) {
        rafIdRef.current = frameId;
      }
    }
  }, []);

  const endDragSession = useCallback(
    (event: PointerEvent<HTMLElement>) => {
      const drag = dragRef.current;
      if (!drag || drag.pointerId !== event.pointerId) return;

      if (rafIdRef.current !== null && typeof window !== "undefined") {
        window.cancelAnimationFrame(rafIdRef.current);
        rafIdRef.current = null;
      }

      try {
        event.currentTarget.releasePointerCapture?.(event.pointerId);
      } catch {
        // Safe fallback when pointer capture release fails.
      }

      restoreBodyStyles();

      const dx = event.clientX - drag.startX;
      const viewportWidth =
        typeof window !== "undefined" ? window.innerWidth : undefined;
      const finalWidth = clampCockpitSidebarWidth(
        drag.startWidth + dx,
        viewportWidth,
      );

      dragRef.current = null;
      pendingWidthRef.current = null;

      setWidth(finalWidth);
      setResizing(false);
      saveCockpitSidebarWidth(getSafeLocalStorage(), finalWidth);
    },
    [restoreBodyStyles],
  );

  const handlePointerCancel = useCallback(
    (event: PointerEvent<HTMLElement>) => {
      endDragSession(event);
    },
    [endDragSession],
  );

  const handleDoubleClick = useCallback(() => {
    setWidth(COCKPIT_SIDEBAR_WIDTH_DEFAULT);
    clearCockpitSidebarWidth(getSafeLocalStorage());
  }, []);

  const handleKeyDown = useCallback((event: KeyboardEvent<HTMLElement>) => {
    const viewportWidth =
      typeof window !== "undefined" ? window.innerWidth : undefined;
    const nextWidth = nextCockpitSidebarWidthForKey(
      widthRef.current,
      event.key,
      event.shiftKey,
      viewportWidth,
    );

    if (nextWidth !== null) {
      event.preventDefault();
      setWidth(nextWidth);
      saveCockpitSidebarWidth(getSafeLocalStorage(), nextWidth);
    }
  }, []);

  useEffect(() => {
    if (!enabled || typeof window === "undefined") return;

    const handleResize = () => {
      setWidth((prev) => clampCockpitSidebarWidth(prev, window.innerWidth));
    };

    window.addEventListener("resize", handleResize);
    return () => {
      window.removeEventListener("resize", handleResize);
    };
  }, [enabled]);

  useEffect(() => {
    return () => {
      if (rafIdRef.current !== null && typeof window !== "undefined") {
        window.cancelAnimationFrame(rafIdRef.current);
        rafIdRef.current = null;
      }
      restoreBodyStyles();
    };
  }, [restoreBodyStyles]);

  useEffect(() => {
    if (!enabled && dragRef.current) {
      if (rafIdRef.current !== null && typeof window !== "undefined") {
        window.cancelAnimationFrame(rafIdRef.current);
        rafIdRef.current = null;
      }
      restoreBodyStyles();
      dragRef.current = null;
      pendingWidthRef.current = null;
      setResizing(false);
    }
  }, [enabled, restoreBodyStyles]);

  const handleProps: CockpitSidebarResizeHandleProps | null = enabled
    ? {
        role: "separator",
        tabIndex: 0,
        "aria-orientation": "vertical",
        "aria-valuenow": width,
        "aria-valuemin": COCKPIT_SIDEBAR_WIDTH_MIN,
        "aria-valuemax": COCKPIT_SIDEBAR_WIDTH_MAX,
        "aria-label": label,
        "data-resizing": resizing ? "true" : "false",
        onPointerDown: handlePointerDown,
        onPointerMove: handlePointerMove,
        onPointerUp: endDragSession,
        onPointerCancel: handlePointerCancel,
        onDoubleClick: handleDoubleClick,
        onKeyDown: handleKeyDown,
      }
    : null;

  const style: CSSProperties = enabled
    ? ({
        "--cockpit-sidebar-width": `${width}px`,
      } as CSSProperties)
    : {};

  return {
    width,
    handleProps,
    style,
    resizing: enabled ? resizing : false,
  };
}
