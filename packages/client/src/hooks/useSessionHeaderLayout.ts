import { useLayoutEffect, useRef, useState } from "react";

export type SessionHeaderLayout = "full" | "compact" | "narrow";

/** Fixed tiers depend on the header column, including a docked sidebar/pane. */
export function useSessionHeaderLayout() {
  const headerRef = useRef<HTMLElement>(null);
  const [layout, setLayout] = useState<SessionHeaderLayout>("narrow");

  useLayoutEffect(() => {
    const header = headerRef.current;
    if (!header) return;
    const measure = () => {
      const width = header.getBoundingClientRect().width;
      setLayout(width >= 720 ? "full" : width >= 600 ? "compact" : "narrow");
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(header);
    return () => observer.disconnect();
  }, []);

  return { headerRef, layout };
}
