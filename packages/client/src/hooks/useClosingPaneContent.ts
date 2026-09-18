import { useEffect, useLayoutEffect, useState } from "react";

/** Keep closing pane content mounted for a nonzero exit animation only. */
export function useClosingPaneContent<T>(
  content: T | null,
  durationMs: number,
): T | null {
  const [retained, setRetained] = useState(content);
  useLayoutEffect(() => {
    if (content !== null) setRetained(content);
  }, [content]);
  const present = content !== null;
  useEffect(() => {
    if (present) return;
    if (durationMs === 0) {
      setRetained(null);
      return;
    }
    const timer = setTimeout(() => setRetained(null), durationMs);
    return () => clearTimeout(timer);
  }, [present, durationMs]);
  // Zero duration renders the end state in this render, before effects run.
  return content ?? (durationMs > 0 ? retained : null);
}
