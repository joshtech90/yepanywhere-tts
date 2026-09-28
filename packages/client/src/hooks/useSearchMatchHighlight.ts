import { useCallback, useEffect, useRef } from "react";
import styles from "./useSearchMatchHighlight.module.css";

function findVisibleMatch(
  row: HTMLElement,
  query: string,
  caseSensitive: boolean,
): Range | null {
  const nodes: Text[] = [];
  const walker = document.createTreeWalker(row, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      return node.parentElement?.closest(
        "button, script, style, [aria-hidden=true]",
      )
        ? NodeFilter.FILTER_REJECT
        : NodeFilter.FILTER_ACCEPT;
    },
  });
  for (let node = walker.nextNode(); node; node = walker.nextNode())
    nodes.push(node as Text);
  const text = nodes.map((node) => node.data).join("");
  if (!query) return null;
  const pattern = query
    .split(/\s+/)
    .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join("\\s+");
  for (const match of text.matchAll(
    new RegExp(pattern, caseSensitive ? "gu" : "giu"),
  )) {
    const index = match.index;
    const matchLength = match[0].length;
    const range = document.createRange();
    let offset = 0;
    let started = false;
    for (const node of nodes) {
      const end = offset + node.length;
      if (!started && index < end) {
        range.setStart(node, index - offset);
        started = true;
      }
      if (started && index + matchLength <= end) {
        range.setEnd(node, index + matchLength - offset);
        break;
      }
      offset = end;
    }
    if (
      typeof range.getClientRects === "function" &&
      [...range.getClientRects()].some(
        (rect) => rect.width > 0 && rect.height > 0,
      )
    )
      return range;
  }
  return null;
}

export function useSearchMatchHighlight(inert: boolean) {
  const cleanupRef = useRef<(() => void) | null>(null);
  const rowRef = useRef<HTMLElement | null>(null);
  const landedRef = useRef(false);
  // Bumped by every clear. A reveal captures it before its asynchronous
  // scroll settles, so a reveal begun before the reader dismissed the landing
  // (or before a new search started) cannot repaint a frame nobody will clear.
  const generationRef = useRef(0);
  const clearSearchMatchHighlight = useCallback(() => {
    generationRef.current += 1;
    landedRef.current = false;
    cleanupRef.current?.();
    cleanupRef.current = null;
  }, []);
  const armLanded = useCallback(() => {
    const cleanup = cleanupRef.current;
    const row = rowRef.current;
    if (!cleanup || !row) return;
    row.classList.add(styles.landed!);
    const events = ["pointerdown", "keydown", "wheel", "touchstart"] as const;
    const release = () => clearSearchMatchHighlight();
    for (const type of events)
      window.addEventListener(type, release, { capture: true, passive: true });
    cleanupRef.current = () => {
      for (const type of events)
        window.removeEventListener(type, release, { capture: true });
      cleanup();
    };
  }, [clearSearchMatchHighlight]);
  useEffect(() => {
    if (inert) clearSearchMatchHighlight();
    return clearSearchMatchHighlight;
  }, [inert, clearSearchMatchHighlight]);
  const highlightSearchMatch = useCallback(
    (
      row: HTMLElement,
      scrollport: HTMLElement,
      query: string,
      caseSensitive: boolean,
    ) => {
      cleanupRef.current?.();
      row.classList.add(styles.target!);
      rowRef.current = row;
      row.dataset.searchMatch = "true";
      const supportsHighlight =
        typeof Highlight !== "undefined" &&
        typeof CSS !== "undefined" &&
        "highlights" in CSS;
      const paint = (scroll: boolean) => {
        const range = findVisibleMatch(row, query.trim(), caseSensitive);
        if (supportsHighlight) {
          CSS.highlights.delete("session-isearch");
          if (range)
            CSS.highlights.set("session-isearch", new Highlight(range));
        }
        if (scroll && range) {
          const rect = range.getBoundingClientRect();
          const port = scrollport.getBoundingClientRect();
          scrollport.scrollTop +=
            rect.top + rect.height / 2 - port.top - scrollport.clientHeight / 2;
        }
      };
      paint(true);
      let pendingFrame: number | null = null;
      const observer = new MutationObserver(() => {
        if (pendingFrame !== null) return;
        pendingFrame = requestAnimationFrame(() => {
          pendingFrame = null;
          paint(false);
        });
      });
      observer.observe(row, {
        childList: true,
        characterData: true,
        subtree: true,
      });
      cleanupRef.current = () => {
        observer.disconnect();
        if (pendingFrame !== null) cancelAnimationFrame(pendingFrame);
        row.classList.remove(styles.target!, styles.landed!);
        if (rowRef.current === row) rowRef.current = null;
        delete row.dataset.searchMatch;
        if (supportsHighlight) CSS.highlights.delete("session-isearch");
      };
      if (landedRef.current) armLanded();
    },
    [armLanded],
  );
  /** Bind a highlight to the current generation; a later clear voids it. */
  const beginSearchMatchReveal = useCallback(() => {
    const generation = generationRef.current;
    return (
      row: HTMLElement,
      scrollport: HTMLElement,
      query: string,
      caseSensitive: boolean,
    ) => {
      if (generationRef.current !== generation) return;
      highlightSearchMatch(row, scrollport, query, caseSensitive);
    };
  }, [highlightSearchMatch]);
  // Once search has closed, the highlight only marks where the jump landed;
  // the reader's next deliberate input shows they have seen it. Programmatic
  // settle scrolls do not count, so listen for input rather than scroll.
  // A re-reveal after the close (layout settling) repaints the same landing,
  // so the landed state is sticky until the highlight is cleared.
  const releaseSearchMatchHighlightOnInput = useCallback(() => {
    landedRef.current = true;
    armLanded();
  }, [armLanded]);
  return {
    beginSearchMatchReveal,
    clearSearchMatchHighlight,
    releaseSearchMatchHighlightOnInput,
  };
}
