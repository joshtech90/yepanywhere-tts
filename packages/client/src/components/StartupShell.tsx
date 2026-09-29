import type { ReactNode } from "react";
import { useLocation } from "react-router-dom";
import {
  type CockpitResolvedTheme,
  readCockpitAppearance,
  resolveCockpitTheme,
} from "../cockpit/core/appearance";
import { isCockpitPathname } from "../cockpit/core/navigation";
import styles from "./StartupShell.module.css";

export type StartupPhase = "module" | "connection";

const SESSION_PATH_PATTERN =
  /(?:^|\/)projects\/[^/]+\/sessions\/[^/?#]+(?:\/|$)/;

export function isSessionStartupPath(pathname: string): boolean {
  return SESSION_PATH_PATTERN.test(pathname);
}

/** The Cockpit's own light or dark, so its loading screen matches it. */
function cockpitStartupTheme(): CockpitResolvedTheme {
  let storage: Storage | null = null;
  try {
    storage = window.localStorage;
  } catch {
    // Blocked storage falls back to the default appearance.
  }
  const prefersDark =
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-color-scheme: dark)").matches;
  return resolveCockpitTheme(readCockpitAppearance(storage).theme, prefersDark);
}

export function StartupShell({
  children,
  phase,
}: {
  children: ReactNode;
  phase: StartupPhase;
}) {
  const location = useLocation();
  const isSession = isSessionStartupPath(location.pathname);

  // The Cockpit loads on its own background, without the classic skeleton,
  // so opening it does not flash a different design first.
  if (isCockpitPathname(location.pathname)) {
    return (
      <div
        className={styles.cockpitShell}
        data-startup-phase={phase}
        data-startup-shell="cockpit"
        data-theme={cockpitStartupTheme()}
      >
        <div className={styles.cockpitStatus} role="status" aria-live="polite">
          <span className={styles.cockpitSpinner} aria-hidden="true" />
          {/* A reconnect can take a while and deserves words; loading the
              page itself is short and stays a spinner. */}
          <span
            className={
              phase === "connection"
                ? styles.cockpitMessage
                : styles.visuallyHidden
            }
          >
            {children}
          </span>
        </div>
      </div>
    );
  }

  const status = (
    <div className={styles.status} role="status" aria-live="polite">
      <span className={styles.spinner} aria-hidden="true" />
      <span>{children}</span>
    </div>
  );

  return (
    <div
      className={styles.shell}
      data-startup-phase={phase}
      data-startup-shell={isSession ? "session" : "page"}
    >
      {isSession ? (
        <>
          <div className={styles.sessionHeader} aria-hidden="true">
            <span className={styles.headerProject} />
            <span className={styles.headerTitle} />
          </div>
          <main className={styles.messageSlot}>{status}</main>
          <div className={styles.composerSlot} aria-hidden="true">
            <div className={styles.composerFrame}>
              <span className={styles.composerLine} />
              <span className={styles.composerActions} />
            </div>
          </div>
        </>
      ) : (
        <main className={styles.genericContent}>{status}</main>
      )}
    </div>
  );
}
