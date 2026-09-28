import { useCallback, useEffect, useState } from "react";
import { UI_KEYS } from "../lib/storageKeys";

export type Theme = "auto" | "light" | "dark" | "verydark";

const themeLabels: Record<Theme, string> = {
  auto: "Auto",
  light: "Light",
  dark: "Dark",
  verydark: "Very Dark",
};

export const THEMES: Theme[] = ["auto", "light", "dark", "verydark"];

export function getThemeLabel(theme: Theme): string {
  return themeLabels[theme];
}

function applyTheme(theme: Theme) {
  const root = document.documentElement;
  root.setAttribute("data-theme", theme);
}

function loadTheme(): Theme {
  const stored = localStorage.getItem(UI_KEYS.theme);
  if (stored && THEMES.includes(stored as Theme)) {
    return stored as Theme;
  }
  return "auto";
}

function saveTheme(theme: Theme) {
  localStorage.setItem(UI_KEYS.theme, theme);
}

/** Another tab saved a theme, or cleared storage (a `null` key). */
function isThemeStorageEvent(event: StorageEvent): boolean {
  return event.key === null || event.key === UI_KEYS.theme;
}

/**
 * Hook to manage theme preference.
 * Persists to localStorage and applies data-theme attribute; follows a theme
 * another tab saves.
 */
export function useTheme() {
  const [theme, setThemeState] = useState<Theme>(loadTheme);

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  useEffect(() => {
    const follow = (event: StorageEvent) => {
      if (isThemeStorageEvent(event)) {
        setThemeState(loadTheme());
      }
    };
    window.addEventListener("storage", follow);
    return () => window.removeEventListener("storage", follow);
  }, []);

  const setTheme = useCallback((newTheme: Theme) => {
    setThemeState(newTheme);
    saveTheme(newTheme);
  }, []);

  return { theme, setTheme };
}

let followingOtherTabs = false;

/**
 * Initialize theme on app load (call once at startup).
 * This runs before React renders to avoid flash of wrong theme.
 *
 * Also keeps the page's data-theme equal to the stored preference when
 * another tab changes it, whether or not a theme picker is mounted here:
 * surfaces that read the preference (`getResolvedTheme`) and the page's CSS
 * must never show two appearances in one tab.
 */
export function initializeTheme() {
  applyTheme(loadTheme());
  if (followingOtherTabs) {
    return;
  }
  followingOtherTabs = true;
  window.addEventListener("storage", (event) => {
    if (isThemeStorageEvent(event)) {
      applyTheme(loadTheme());
    }
  });
}

/**
 * Get current resolved theme (useful for components that need
 * to know if we're actually in light or dark mode when auto)
 */
export function getResolvedTheme(): "light" | "dark" {
  const stored = loadTheme();
  if (stored === "auto") {
    return window.matchMedia("(prefers-color-scheme: light)").matches
      ? "light"
      : "dark";
  }
  return stored === "light" ? "light" : "dark";
}

/**
 * Hook to reactively get the resolved theme (light or dark).
 * Listens for both localStorage changes and system preference changes.
 */
export function useResolvedTheme(): "light" | "dark" {
  const [resolved, setResolved] = useState<"light" | "dark">(getResolvedTheme);

  useEffect(() => {
    const update = () => setResolved(getResolvedTheme());

    // Listen for system preference changes
    const mediaQuery = window.matchMedia("(prefers-color-scheme: light)");
    mediaQuery.addEventListener("change", update);

    // Listen for storage changes (theme changed in another tab or by useTheme)
    window.addEventListener("storage", update);

    // Also listen for attribute changes on documentElement (for same-tab updates)
    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (
          mutation.type === "attributes" &&
          mutation.attributeName === "data-theme"
        ) {
          update();
          break;
        }
      }
    });
    observer.observe(document.documentElement, { attributes: true });

    return () => {
      mediaQuery.removeEventListener("change", update);
      window.removeEventListener("storage", update);
      observer.disconnect();
    };
  }, []);

  return resolved;
}
