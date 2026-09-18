import { useSyncExternalStore } from "react";
import { createLocalStorageBoolean } from "../lib/localStorageValue";
import { UI_KEYS } from "../lib/storageKeys";
import { useMediaQuery } from "./useMediaQuery";

const store = createLocalStorageBoolean(UI_KEYS.panelSlideAnimations, true);

export function usePanelSlideAnimations() {
  const reducedMotion = useMediaQuery("(prefers-reduced-motion: reduce)");
  const panelSlideAnimations = useSyncExternalStore(
    store.subscribe,
    store.read,
    store.read,
  );
  return {
    panelSlideAnimations,
    setPanelSlideAnimations: store.set,
    panelSlideDurationMs: panelSlideAnimations && !reducedMotion ? 200 : 0,
  };
}
