import { useLayoutEffect, useState, type CSSProperties } from "react";

interface CockpitViewportSnapshot {
  height: number | null;
  keyboardOpen: boolean;
  offsetTop: number;
}

export interface CockpitViewportGeometry {
  keyboardOpen: boolean;
  style: CSSProperties;
}

function readViewport(): CockpitViewportSnapshot {
  if (typeof window === "undefined" || !window.visualViewport) {
    return { height: null, keyboardOpen: false, offsetTop: 0 };
  }
  const viewport = window.visualViewport;
  return {
    height: Math.max(0, viewport.height),
    keyboardOpen: window.innerHeight - viewport.height > 120,
    offsetTop: Math.max(0, viewport.offsetTop),
  };
}

export function useCockpitViewportGeometry(): CockpitViewportGeometry {
  const [snapshot, setSnapshot] = useState(readViewport);

  useLayoutEffect(() => {
    const viewport = window.visualViewport;
    if (!viewport) return;
    let frame: number | null = null;
    const update = () => {
      if (frame !== null) cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        frame = null;
        setSnapshot(readViewport());
      });
    };
    viewport.addEventListener("resize", update);
    viewport.addEventListener("scroll", update);
    window.addEventListener("resize", update);
    update();
    return () => {
      viewport.removeEventListener("resize", update);
      viewport.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
      if (frame !== null) cancelAnimationFrame(frame);
    };
  }, []);

  return {
    keyboardOpen: snapshot.keyboardOpen,
    style: {
      "--cockpit-viewport-height": snapshot.height !== null
        ? `${snapshot.height}px`
        : "100dvh",
      "--cockpit-viewport-offset-top": `${snapshot.offsetTop}px`,
    } as CSSProperties,
  };
}
