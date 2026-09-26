import { useCallback, useEffect, useRef, useState } from "react";
import { getLocalStorage } from "../lib/localStorageValue";
import {
  COCKPIT_APPEARANCE_STORAGE_KEY,
  type CockpitAccent,
  type CockpitAppearance,
  type CockpitTheme,
  readCockpitAppearance,
  resolveCockpitTheme,
  saveCockpitAppearance,
} from "./core/appearance";

function getPrefersDark(): boolean {
  return (
    typeof window !== "undefined" &&
    window.matchMedia?.("(prefers-color-scheme: dark)").matches === true
  );
}

export function useCockpitAppearance() {
  const [appearance, setAppearance] = useState<CockpitAppearance>(() =>
    readCockpitAppearance(getLocalStorage()),
  );
  const appearanceRef = useRef(appearance);
  const [prefersDark, setPrefersDark] = useState(getPrefersDark);

  useEffect(() => {
    const media = window.matchMedia?.("(prefers-color-scheme: dark)");
    const onSystemThemeChange = () => setPrefersDark(getPrefersDark());
    const onStorage = (event: StorageEvent) => {
      if (
        event.key === null ||
        event.key === COCKPIT_APPEARANCE_STORAGE_KEY
      ) {
        const next = readCockpitAppearance(getLocalStorage());
        appearanceRef.current = next;
        setAppearance(next);
      }
    };

    media?.addEventListener("change", onSystemThemeChange);
    window.addEventListener("storage", onStorage);
    return () => {
      media?.removeEventListener("change", onSystemThemeChange);
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  const updateAppearance = useCallback(
    (update: (current: CockpitAppearance) => CockpitAppearance) => {
      const next = update(appearanceRef.current);
      appearanceRef.current = next;
      setAppearance(next);
      saveCockpitAppearance(getLocalStorage(), next);
    },
    [],
  );

  const setTheme = useCallback(
    (theme: CockpitTheme) =>
      updateAppearance((current) => ({ ...current, theme })),
    [updateAppearance],
  );
  const setAccent = useCallback(
    (accent: CockpitAccent) =>
      updateAppearance((current) => ({ ...current, accent })),
    [updateAppearance],
  );

  return {
    ...appearance,
    resolvedTheme: resolveCockpitTheme(appearance.theme, prefersDark),
    setTheme,
    setAccent,
  };
}
