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
  const renewHighlightRef = useRef<(() => void) | null>(null);
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
    const row = rowRef.current;
    if (!row) return;
    row.classList.add(styles.landed!);
  }, []);
  useEffect(() => {
    if (inert) clearSearchMatchHighlight();
    return clearSearchMatchHighlight;
  }, [inert, clearSearchMatchHighlight]);
  const highlightSearchMatch = useCallback(
    (
      initialRow: HTMLElement,
      scrollport: HTMLElement,
      query: string,
      caseSensitive: boolean,
    ) => {
      cleanupRef.current?.();
      let row = initialRow;
      const renderId = row.dataset.renderId;
      const generation = generationRef.current;
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
      let idleTimer: ReturnType<typeof setTimeout>;
      let fadeTimer: ReturnType<typeof setTimeout> | undefined;
      const renewHighlight = () => {
        clearTimeout(idleTimer);
        clearTimeout(fadeTimer);
        row.classList.remove(styles.fading!);
        idleTimer = setTimeout(() => {
          row.classList.add(styles.fading!);
          fadeTimer = setTimeout(clearSearchMatchHighlight, 3000);
        }, 2000);
      };
      const events = [
        "pointerdown",
        "pointermove",
        "keydown",
        "wheel",
        "touchstart",
      ] as const;
      for (const type of events)
        window.addEventListener(type, renewHighlight, {
          capture: true,
          passive: true,
        });
      renewHighlight();
      renewHighlightRef.current = renewHighlight;
      let pendingFrame: number | null = null;
      const schedulePaint = () => {
        if (pendingFrame !== null) return;
        pendingFrame = requestAnimationFrame(() => {
          pendingFrame = null;
          if (generation !== generationRef.current) return;
          if (!row.isConnected) {
            const replacement =
              renderId &&
              [
                ...scrollport.querySelectorAll<HTMLElement>("[data-render-id]"),
              ].find(
                (candidate) =>
                  candidate.isConnected &&
                  candidate.dataset.renderId === renderId,
              );
            if (!replacement) return;
            const fading = row.classList.contains(styles.fading!);
            row.classList.remove(
              styles.target!,
              styles.landed!,
              styles.fading!,
            );
            delete row.dataset.searchMatch;
            row = replacement;
            rowRef.current = row;
            observeContent();
            row.classList.add(styles.target!);
            row.dataset.searchMatch = "true";
            if (fading) row.classList.add(styles.fading!);
            if (landedRef.current) armLanded();
          }
          paint(false);
        });
      };
      const observer = new MutationObserver(schedulePaint);
      const observeContent = () => {
        observer.disconnect();
        observer.observe(row, {
          childList: true,
          characterData: true,
          subtree: true,
        });
      };
      observeContent();
      // A timeline regroup can replace the element while retaining its turn
      // identity. Watch structural changes separately so unrelated streaming
      // text does not produce records for this highlight's content observer.
      const remountObserver = new MutationObserver(() => {
        if (!row.isConnected) schedulePaint();
      });
      remountObserver.observe(scrollport, {
        childList: true,
        subtree: true,
      });
      cleanupRef.current = () => {
        renewHighlightRef.current = null;
        clearTimeout(idleTimer);
        clearTimeout(fadeTimer);
        for (const type of events)
          window.removeEventListener(type, renewHighlight, { capture: true });
        observer.disconnect();
        remountObserver.disconnect();
        if (pendingFrame !== null) cancelAnimationFrame(pendingFrame);
        row.classList.remove(styles.target!, styles.landed!, styles.fading!);
        if (rowRef.current === row) rowRef.current = null;
        delete row.dataset.searchMatch;
        if (supportsHighlight) CSS.highlights.delete("session-isearch");
      };
      if (landedRef.current) armLanded();
    },
    [armLanded, clearSearchMatchHighlight],
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
  const markSearchMatchLanded = useCallback(() => {
    landedRef.current = true;
    armLanded();
    renewHighlightRef.current?.();
  }, [armLanded]);
  return {
    beginSearchMatchReveal,
    clearSearchMatchHighlight,
    markSearchMatchLanded,
  };
}
