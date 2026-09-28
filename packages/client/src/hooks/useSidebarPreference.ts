import { useCallback, useRef, useState } from "react";
import { UI_KEYS } from "../lib/storageKeys";

/** The desktop sidebar's display modes (topics/ui-architecture.md). */
export type SidebarDisplayMode = "expanded" | "collapsed" | "minimized";

// The mode persists as the two browser-local keys (sidebarExpanded,
// sidebarMinimized) rather than one enum key, so stored preferences and
// browserSettingsBackup round-trip unchanged across bundle versions.
function loadStoredMode(): SidebarDisplayMode {
  if (typeof window === "undefined") {
    return "expanded";
  }
  // No stored preference defaults to expanded.
  if (localStorage.getItem(UI_KEYS.sidebarExpanded) === "false") {
    return localStorage.getItem(UI_KEYS.sidebarMinimized) === "true"
      ? "minimized"
      : "collapsed";
  }
  return "expanded";
}

function saveStoredMode(mode: SidebarDisplayMode): void {
  localStorage.setItem(UI_KEYS.sidebarExpanded, String(mode === "expanded"));
  localStorage.setItem(UI_KEYS.sidebarMinimized, String(mode === "minimized"));
}

/**
 * Hook to manage the sidebar display-mode preference.
 * Persists to localStorage.
 *
 * `initialMode` narrows the sidebar for this mount only, without saving: a
 * page that wants the room starts collapsed, and a tab opened straight onto
 * the new-session composer starts minimized. It never widens a stored mode.
 */
export function useSidebarPreference(
  forceExpanded = false,
  initialMode: "collapsed" | "minimized" | null = null,
): {
  isExpanded: boolean;
  isMinimized: boolean;
  toggleExpanded: () => void;
  minimizeToFloatingToggle: () => void;
  restoreCollapsedSidebar: () => void;
} {
  const [mode, setModeState] = useState<SidebarDisplayMode>(() => {
    if (forceExpanded) return "expanded";
    const stored = loadStoredMode();
    if (initialMode === "minimized") return "minimized";
    return initialMode === "collapsed" && stored === "expanded"
      ? "collapsed"
      : stored;
  });
  // Restoring from a minimized start the user never chose returns to their
  // stored mode instead of saving a collapsed one over it.
  const transientlyMinimizedRef = useRef(
    mode === "minimized" && loadStoredMode() !== "minimized",
  );

  const setMode = useCallback((next: SidebarDisplayMode) => {
    transientlyMinimizedRef.current = false;
    setModeState(next);
    saveStoredMode(next);
  }, []);

  const toggleExpanded = useCallback(() => {
    transientlyMinimizedRef.current = false;
    // Use functional update to avoid stale closure issues
    setModeState((prev) => {
      const next = prev === "expanded" ? "collapsed" : "expanded";
      saveStoredMode(next);
      return next;
    });
  }, []);

  const minimizeToFloatingToggle = useCallback(
    () => setMode("minimized"),
    [setMode],
  );

  const restoreCollapsedSidebar = useCallback(() => {
    if (transientlyMinimizedRef.current) {
      transientlyMinimizedRef.current = false;
      setModeState(loadStoredMode());
      return;
    }
    setMode("collapsed");
  }, [setMode]);

  return {
    isExpanded: mode === "expanded",
    isMinimized: mode === "minimized",
    toggleExpanded,
    minimizeToFloatingToggle,
    restoreCollapsedSidebar,
  };
}
