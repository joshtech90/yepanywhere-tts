import { startTransition, useEffect, useState } from "react";
import {
  normalizeSearchPreviewText,
  type SessionContentMatch,
} from "@yep-anywhere/shared";

/** Comma-separated search needles; quoted commas and doubled quotes are literal. */
export function searchNeedles(query: string, enabled: boolean): string[] {
  if (!enabled) return [query.trim()].filter(Boolean);
  const terms: string[] = [];
  let term = "";
  let quoted = false;
  for (let i = 0; i < query.length; i++) {
    const char = query[i];
    if (char === '"') {
      if (quoted && query[i + 1] === '"') {
        term += '"';
        i++;
      } else quoted = !quoted;
    } else if (char === "," && !quoted) {
      if (term.trim()) terms.push(term.trim());
      term = "";
    } else term += char;
  }
  if (term.trim()) terms.push(term.trim());
  return terms;
}

export function containsSearchNeedles(
  text: string,
  needles: readonly string[],
) {
  const normalized = normalizeSearchPreviewText(text)
    .replace(/\s+/g, " ")
    .toLowerCase();
  return needles.every((needle) =>
    normalized.includes(needle.replace(/\s+/g, " ").toLowerCase()),
  );
}

/** Filter the first needle's live stream in interruptible slices, preserving its cache. */
export function useSearchIntersection(
  input: Map<string, SessionContentMatch[]>,
  needles: readonly string[],
) {
  const [result, setResult] = useState({
    input,
    needles,
    matches: input,
    incomplete: new Set<string>(),
  });
  const needed = needles.length > 1;
  useEffect(() => {
    if (!needed) return;
    let cancelled = false;
    void (async () => {
      const matches = new Map<string, SessionContentMatch[]>();
      const incomplete = new Set<string>();
      let started = performance.now();
      for (const [id, hits] of input) {
        const found: SessionContentMatch[] = [];
        for (const hit of hits) {
          if (hit.searchText === undefined) incomplete.add(id);
          if (
            hit.searchText !== undefined &&
            containsSearchNeedles(hit.searchText, needles)
          )
            found.push(hit);
          if (performance.now() - started >= 8) {
            await new Promise<void>((resolve) => setTimeout(resolve, 0));
            if (cancelled) return;
            started = performance.now();
          }
        }
        if (found.length) matches.set(id, found);
      }
      if (!cancelled)
        startTransition(() =>
          setResult({ input, needles, matches, incomplete }),
        );
    })();
    return () => {
      cancelled = true;
    };
  }, [input, needles, needed]);
  return {
    matches: needed ? result.matches : input,
    filtering: needed && (result.input !== input || result.needles !== needles),
    incomplete: needed ? result.incomplete : undefined,
  };
}
