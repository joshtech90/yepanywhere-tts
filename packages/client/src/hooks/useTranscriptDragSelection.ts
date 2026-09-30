import { type RefObject, useEffect } from "react";

interface Caret {
  node: Node;
  offset: number;
}

interface Press {
  content: HTMLElement;
  x: number;
  y: number;
  base: Caret | null;
  dragging: boolean;
  takenOver: boolean;
}

const DRAG_START_DISTANCE_PX = 3;

function caretAtPoint(doc: Document, x: number, y: number): Caret | null {
  const position = doc.caretPositionFromPoint?.(x, y);
  if (position) return { node: position.offsetNode, offset: position.offset };
  const range = doc.caretRangeFromPoint?.(x, y);
  return range
    ? { node: range.startContainer, offset: range.startOffset }
    : null;
}

/**
 * Keep a mouse drag selection in the transcript anchored where it started.
 *
 * Live activity re-renders transcript rows while the button is held. The
 * browser owns the drag, and when anything disturbs its record of the press
 * point it restarts the selection wherever the pointer is on every move: the
 * highlight collapses, and on release there is nothing to copy. The hook
 * records the caret the browser placed on press. While the browser's own drag
 * keeps starting there, nothing is written. Once a move shows the browser has
 * lost that start, the hook takes the rest of this drag over: it cancels each
 * move's default so the browser stops re-collapsing the selection, and it
 * spans `press point → pointer` itself, through release.
 *
 * Double- and triple-click drags (word/line granularity), Shift-extension,
 * and presses on interactive controls stay entirely native. Listeners live on
 * the document and resolve the transcript element per press, so a transcript
 * that mounts after this hook is still covered.
 */
export function useTranscriptDragSelection(
  contentRef: RefObject<HTMLElement | null>,
  isInteractiveTarget: (target: EventTarget | null) => boolean,
  inert: boolean,
): void {
  useEffect(() => {
    if (inert) return;
    const doc = document;
    let press: Press | null = null;
    let baseTimer: ReturnType<typeof setTimeout> | null = null;

    const clear = () => {
      press = null;
      if (baseTimer !== null) clearTimeout(baseTimer);
      baseTimer = null;
    };

    const liveBase = (current: Press): Caret | null => {
      const base = current.base;
      return base?.node.isConnected && current.content.contains(base.node)
        ? base
        : null;
    };

    const startsAtBase = (base: Caret): boolean => {
      const selection = doc.getSelection();
      return (
        selection?.anchorNode === base.node &&
        selection.anchorOffset === base.offset
      );
    };

    const span = (current: Press, base: Caret, x: number, y: number) => {
      const extent = caretAtPoint(doc, x, y);
      if (!extent || !current.content.contains(extent.node)) return;
      doc
        .getSelection()
        ?.setBaseAndExtent(base.node, base.offset, extent.node, extent.offset);
    };

    const handleMouseDown = (event: MouseEvent) => {
      clear();
      const content = contentRef.current;
      if (
        !content ||
        !(event.target instanceof Node) ||
        !content.contains(event.target) ||
        event.button !== 0 ||
        event.detail > 1 ||
        event.shiftKey ||
        event.altKey ||
        event.ctrlKey ||
        event.metaKey ||
        isInteractiveTarget(event.target)
      ) {
        return;
      }
      const current: Press = {
        content,
        x: event.clientX,
        y: event.clientY,
        base: null,
        dragging: false,
        takenOver: false,
      };
      press = current;
      // The browser places its caret after the press dispatches; that caret,
      // not a hit test of ours, is the drag's true start.
      baseTimer = setTimeout(() => {
        baseTimer = null;
        const selection = doc.getSelection();
        if (
          press === current &&
          selection?.isCollapsed &&
          selection.anchorNode &&
          content.contains(selection.anchorNode)
        ) {
          current.base = {
            node: selection.anchorNode,
            offset: selection.anchorOffset,
          };
        }
      }, 0);
    };

    const handleMouseMove = (event: MouseEvent) => {
      const current = press;
      if (!current) return;
      if ((event.buttons & 1) === 0) {
        clear();
        return;
      }
      if (
        !current.dragging &&
        Math.hypot(event.clientX - current.x, event.clientY - current.y) <
          DRAG_START_DISTANCE_PX
      ) {
        return;
      }
      current.dragging = true;
      const base = liveBase(current);
      if (!base) return;
      if (!current.takenOver && startsAtBase(base)) return;
      current.takenOver = true;
      event.preventDefault();
      span(current, base, event.clientX, event.clientY);
    };

    const handleMouseUp = (event: MouseEvent) => {
      const released = press;
      clear();
      if (!released?.dragging) return;
      const base = liveBase(released);
      if (!base) return;
      const x = event.clientX;
      const y = event.clientY;
      if (released.takenOver) span(released, base, x, y);
      // The release's own default handling runs after this listener.
      requestAnimationFrame(() => {
        if (!startsAtBase(base)) span(released, base, x, y);
      });
    };

    doc.addEventListener("mousedown", handleMouseDown, true);
    doc.addEventListener("mousemove", handleMouseMove, true);
    doc.addEventListener("mouseup", handleMouseUp, true);
    window.addEventListener("blur", clear);
    return () => {
      clear();
      doc.removeEventListener("mousedown", handleMouseDown, true);
      doc.removeEventListener("mousemove", handleMouseMove, true);
      doc.removeEventListener("mouseup", handleMouseUp, true);
      window.removeEventListener("blur", clear);
    };
  }, [contentRef, inert, isInteractiveTarget]);
}
