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
  const clearSearchMatchHighlight = useCallback(() => {
    cleanupRef.current?.();
    cleanupRef.current = null;
  }, []);
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
        row.classList.remove(styles.target!);
        delete row.dataset.searchMatch;
        if (supportsHighlight) CSS.highlights.delete("session-isearch");
      };
    },
    [],
  );
  return { highlightSearchMatch, clearSearchMatchHighlight };
}
