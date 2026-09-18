import { useEffect, useRef, useState } from "react";
import { normalizeSearchPreviewText } from "@yep-anywhere/shared";
import { renderHighlightedText } from "../SearchPreview";
import styles from "./SessionSearch.module.css";

/** Fit around the match using this flex item's actual width and inherited font. */
export function SearchTitle({ text, query }: { text: string; query: string }) {
  const element = useRef<HTMLSpanElement>(null);
  const canvas = useRef<CanvasRenderingContext2D | null>(null);
  const normalized = normalizeSearchPreviewText(text)
    .replace(/\s+/g, " ")
    .trim();
  const needle = query.replace(/\s+/g, " ").trim();
  const [excerpt, setExcerpt] = useState(normalized);
  useEffect(() => {
    if (!needle) {
      setExcerpt(normalized);
      return;
    }
    const node = element.current;
    if (!node) return;
    if (!canvas.current)
      canvas.current = document.createElement("canvas").getContext("2d");
    const context = canvas.current;
    if (!context) return;
    const measureExcerpt = () => {
      const style = getComputedStyle(node);
      const font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
      const markStyle = getComputedStyle(node.querySelector("mark") ?? node);
      const markedFont = `${markStyle.fontWeight} ${markStyle.fontSize} ${markStyle.fontFamily}`;
      const spacing = Number.parseFloat(style.letterSpacing) || 0;
      const width = node.clientWidth;
      const fits = (value: string) => {
        let measured = spacing * value.length;
        let offset = 0;
        const lower = value.toLowerCase();
        while (needle && offset < value.length) {
          const at = lower.indexOf(needle.toLowerCase(), offset);
          if (at < 0) break;
          context.font = font;
          measured += context.measureText(value.slice(offset, at)).width;
          context.font = markedFont;
          measured += context.measureText(
            value.slice(at, at + needle.length),
          ).width;
          offset = at + needle.length;
        }
        context.font = font;
        return (
          measured + context.measureText(value.slice(offset)).width <= width
        );
      };
      const index = normalized.toLowerCase().indexOf(needle.toLowerCase());
      if (!needle || index < 0 || fits(normalized)) {
        setExcerpt(normalized);
        return;
      }
      const at = (length: number) => {
        const start = Math.max(
          0,
          Math.min(
            index - Math.floor((length - needle.length) / 2),
            normalized.length - length,
          ),
        );
        const end = Math.min(normalized.length, start + length);
        return `${start ? "…" : ""}${normalized.slice(start, end)}${end < normalized.length ? "…" : ""}`;
      };
      let low = needle.length,
        high = normalized.length;
      while (low < high) {
        const middle = Math.ceil((low + high) / 2);
        if (fits(at(middle))) low = middle;
        else high = middle - 1;
      }
      setExcerpt(at(low));
    };
    // Title fitting must not run in the keyboard echo's pre-paint commit.
    // Coalesce resize notifications and give each row a cancellable task.
    let timer: ReturnType<typeof setTimeout>;
    const schedule = () => {
      clearTimeout(timer);
      timer = setTimeout(measureExcerpt, 0);
    };
    schedule();
    const observer = new ResizeObserver(schedule);
    observer.observe(node);
    return () => {
      clearTimeout(timer);
      observer.disconnect();
    };
  }, [normalized, needle]);
  return (
    <span ref={element} className={styles.matchedTitle} title={text}>
      {renderHighlightedText(excerpt, needle)}
    </span>
  );
}
