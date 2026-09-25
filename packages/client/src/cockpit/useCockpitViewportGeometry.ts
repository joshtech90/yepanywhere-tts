import { useLayoutEffect, useRef, useState, type CSSProperties } from "react";

interface CockpitViewportSnapshot {
  height: number | null;
  keyboardOpen: boolean;
  offsetTop: number;
}

interface CockpitViewportBaseline {
  innerHeight: number;
  visualHeight: number;
}

export interface CockpitViewportGeometry {
  keyboardOpen: boolean;
  style: CSSProperties;
}

function readViewport(
  baselineRef: { current: CockpitViewportBaseline | null },
): CockpitViewportSnapshot {
  if (typeof window === "undefined" || !window.visualViewport) {
    return { height: null, keyboardOpen: false, offsetTop: 0 };
  }
  const viewport = window.visualViewport;
  const visualHeight = Math.max(0, viewport.height);
  const innerHeight = Math.max(0, window.innerHeight);
  const baseline = baselineRef.current;
  if (!baseline || baseline.innerHeight !== innerHeight) {
    baselineRef.current = { innerHeight, visualHeight };
  } else if (visualHeight > baseline.visualHeight) {
    baseline.visualHeight = visualHeight;
  }
  const currentBaseline = baselineRef.current;
  const keyboardOpen = currentBaseline
    ? currentBaseline.visualHeight - visualHeight > 120
    : false;
  const initialBrowserInset = !keyboardOpen && innerHeight - visualHeight > 120;
  return {
    height: initialBrowserInset ? innerHeight : visualHeight,
    keyboardOpen,
    offsetTop: Math.max(0, viewport.offsetTop),
  };
}

export function useCockpitViewportGeometry(): CockpitViewportGeometry {
  const baselineRef = useRef<CockpitViewportBaseline | null>(null);
  const [snapshot, setSnapshot] = useState(() => readViewport(baselineRef));

  useLayoutEffect(() => {
    const viewport = window.visualViewport;
    if (!viewport) return;
    let frame: number | null = null;
    const update = () => {
      if (frame !== null) cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        frame = null;
        setSnapshot(readViewport(baselineRef));
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
