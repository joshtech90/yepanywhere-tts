import { useEffect, useRef, type RefObject } from "react";
import { useNavigate } from "react-router-dom";
import type { CockpitNavigation } from "./core/navigation";
import { resolveCockpitShortcut } from "./core/shortcuts";

const NAVIGATION_PREFIX_TIMEOUT_MS = 1_200;

export interface CockpitShortcutOptions {
  navigation: CockpitNavigation;
  onCloseHelp: () => void;
  onCloseSearch: () => void;
  onOpenHelp: () => void;
  onOpenSearch: () => void;
  rootRef: RefObject<HTMLElement | null>;
  searchOpen: boolean;
  shortcutsOpen: boolean;
}

export function useCockpitShortcuts({
  navigation,
  onCloseHelp,
  onCloseSearch,
  onOpenHelp,
  onOpenSearch,
  rootRef,
  searchOpen,
  shortcutsOpen,
}: CockpitShortcutOptions): void {
  const navigate = useNavigate();
  const navigationPrefixRef = useRef(false);
  const navigationTimerRef = useRef<number | undefined>(undefined);

  useEffect(() => {
    const clearNavigationPrefix = () => {
      navigationPrefixRef.current = false;
      if (navigationTimerRef.current !== undefined) {
        window.clearTimeout(navigationTimerRef.current);
        navigationTimerRef.current = undefined;
      }
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && shortcutsOpen) {
        event.preventDefault();
        onCloseHelp();
        return;
      }
      if (shortcutsOpen) return;
      if (event.key === "Escape" && searchOpen) {
        event.preventDefault();
        onCloseSearch();
        return;
      }

      const action = resolveCockpitShortcut(
        event,
        navigationPrefixRef.current,
      );
      if (action !== "navigation-prefix") clearNavigationPrefix();
      if (!action) return;

      if (action === "navigation-prefix") {
        event.preventDefault();
        clearNavigationPrefix();
        navigationPrefixRef.current = true;
        navigationTimerRef.current = window.setTimeout(
          clearNavigationPrefix,
          NAVIGATION_PREFIX_TIMEOUT_MS,
        );
        return;
      }

      if (action === "stop") {
        const stop = rootRef.current?.querySelector<HTMLButtonElement>(
          '[data-cockpit-shortcut="stop"]:not(:disabled), ' +
            'button[aria-keyshortcuts~="Escape"]:not(:disabled)',
        );
        if (!stop) return;
        event.preventDefault();
        stop.click();
        return;
      }

      if (action === "composer") {
        const composer = rootRef.current?.querySelector<HTMLTextAreaElement>(
          '[data-cockpit-shortcut="composer"]',
        );
        if (!composer) return;
        event.preventDefault();
        composer.focus({ preventScroll: true });
        return;
      }

      event.preventDefault();
      if (action === "help") onOpenHelp();
      if (action === "search") onOpenSearch();
      if (action === "new-session") navigate(navigation.newSession);
      if (action === "sessions") navigate(navigation.sessions);
      if (action === "projects") navigate(navigation.projects);
    };

    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      clearNavigationPrefix();
    };
  }, [
    navigate,
    navigation,
    onCloseHelp,
    onCloseSearch,
    onOpenHelp,
    onOpenSearch,
    rootRef,
    searchOpen,
    shortcutsOpen,
  ]);
}
