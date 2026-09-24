import { useSyncExternalStore, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { useCurrentSourceRuntime } from "../contexts/SourceRuntimeContext";
import { useRemoteBasePath } from "../hooks/useRemoteBasePath";
import { useI18n } from "../i18n";
import {
  CockpitAppearanceControls,
  type CockpitAppearanceControlsProps,
} from "./CockpitAppearanceControls";
import styles from "./CockpitPage.module.css";
import type { CockpitResolvedTheme } from "./core/appearance";
import { createCockpitNavigation } from "./core/navigation";
import {
  deriveCockpitShellState,
  type CockpitShellState,
} from "./core/shellState";
import { useCockpitAppearance } from "./useCockpitAppearance";

function SessionsIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M5 6.5h14M5 12h14M5 17.5h9" />
    </svg>
  );
}

function ProjectsIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M3.5 7.5h6l1.7 2H20.5v8.7a1.8 1.8 0 0 1-1.8 1.8H5.3a1.8 1.8 0 0 1-1.8-1.8V7.5Z" />
      <path d="M3.5 10h17" />
    </svg>
  );
}

function NewSessionIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

function SettingsIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="3" />
      <path d="M19 12a7 7 0 0 0-.1-1.2l2-1.6-2-3.4-2.5 1a7.4 7.4 0 0 0-2.1-1.2L14 3h-4l-.4 2.6a7.4 7.4 0 0 0-2.1 1.2l-2.5-1-2 3.4 2 1.6A7 7 0 0 0 5 12c0 .4 0 .8.1 1.2l-2 1.6 2 3.4 2.5-1a7.4 7.4 0 0 0 2.1 1.2L10 21h4l.4-2.6a7.4 7.4 0 0 0 2.1-1.2l2.5 1 2-3.4-2-1.6c.1-.4.1-.8.1-1.2Z" />
    </svg>
  );
}

function AppearanceIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 3.5a8.5 8.5 0 1 0 0 17c1.2 0 1.8-.7 1.8-1.5 0-.7-.4-1.2-.4-1.9 0-1 .8-1.8 1.8-1.8h1.7c2.1 0 3.6-1.6 3.6-3.7 0-4.5-3.8-8.1-8.5-8.1Z" />
      <circle cx="7.8" cy="10" r=".7" />
      <circle cx="10" cy="6.8" r=".7" />
      <circle cx="14" cy="6.8" r=".7" />
      <circle cx="16.3" cy="10.2" r=".7" />
    </svg>
  );
}

function StateIcon({ kind }: { kind: CockpitShellState["kind"] }) {
  if (kind === "loading") {
    return <span className={styles.loadingSpinner} aria-hidden="true" />;
  }
  if (kind === "offline") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M4 8.5a12 12 0 0 1 16 0M7 12a7.6 7.6 0 0 1 10 0M10.2 15.4a3 3 0 0 1 3.6 0M4 4l16 16" />
      </svg>
    );
  }
  if (kind === "error") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M12 4 21 20H3L12 4Z" />
        <path d="M12 9v5M12 17.2v.1" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M7 3.5h10v3H7zM5 6.5h14v14H5zM8.5 10.5h7M8.5 14h7M8.5 17.5h4" />
    </svg>
  );
}

interface CockpitShellProps extends CockpitAppearanceControlsProps {
  basePath: string;
  resolvedTheme: CockpitResolvedTheme;
  shellState: CockpitShellState;
}

export function CockpitShell({
  accent,
  basePath,
  onAccentChange,
  onThemeChange,
  resolvedTheme,
  shellState,
  theme,
}: CockpitShellProps) {
  const { t } = useI18n();
  const navigation = createCockpitNavigation(basePath);
  const destinations: Array<{
    href: string;
    label: string;
    icon: ReactNode;
  }> = [
    {
      href: navigation.sessions,
      label: t("sidebarAllSessions"),
      icon: <SessionsIcon />,
    },
    {
      href: navigation.projects,
      label: t("sidebarProjects"),
      icon: <ProjectsIcon />,
    },
    {
      href: navigation.newSession,
      label: t("sidebarNewSession"),
      icon: <NewSessionIcon />,
    },
    {
      href: navigation.settings,
      label: t("sidebarSettings"),
      icon: <SettingsIcon />,
    },
  ];
  const stateCopy = {
    empty: {
      title: t("cockpitEmptyTitle"),
      body: t("cockpitEmptyBody"),
      status: t("cockpitStatusConnected"),
    },
    loading: {
      title: t("cockpitLoadingTitle"),
      body: t("cockpitLoadingBody"),
      status: t("cockpitStatusConnecting"),
    },
    offline: {
      title: t("cockpitOfflineTitle"),
      body: t("cockpitOfflineBody"),
      status: t("cockpitStatusOffline"),
    },
    error: {
      title: t("cockpitErrorTitle"),
      body: t("cockpitErrorBody"),
      status: t("cockpitStatusError"),
    },
  }[shellState.kind];

  return (
    <main
      className={styles.root}
      data-accent={accent}
      data-theme={resolvedTheme}
    >
      <aside className={styles.sidebar} aria-label={t("cockpitNavigationAria")}>
        <Link className={styles.brand} to={navigation.cockpit}>
          <span className={styles.brandMark}>C</span>
          <span>
            <strong>Cockpit</strong>
            <small>Yep Anywhere</small>
          </span>
        </Link>

        <nav className={styles.navigation}>
          {destinations.map((destination) => (
            <Link
              className={styles.navigationItem}
              key={destination.href}
              to={destination.href}
            >
              <span className={styles.icon}>{destination.icon}</span>
              <span>{destination.label}</span>
            </Link>
          ))}
        </nav>

        <section
          aria-label={t("cockpitAppearanceLabel")}
          className={styles.desktopAppearance}
        >
          <CockpitAppearanceControls
            accent={accent}
            onAccentChange={onAccentChange}
            onThemeChange={onThemeChange}
            theme={theme}
          />
        </section>
      </aside>

      <section className={styles.workspace} aria-labelledby="cockpit-title">
        <header className={styles.header}>
          <div>
            <div className={styles.eyebrow}>{t("cockpitEyebrow")}</div>
            <h1 id="cockpit-title">Cockpit</h1>
          </div>
          <div className={styles.headerActions}>
            <span
              className={styles.connectionStatus}
              data-state={shellState.kind}
            >
              <span aria-hidden="true" />
              {stateCopy.status}
            </span>
            <details className={styles.mobileAppearance}>
              <summary aria-label={t("cockpitAppearanceLabel")}>
                <AppearanceIcon />
              </summary>
              <div className={styles.mobileAppearancePanel}>
                <CockpitAppearanceControls
                  accent={accent}
                  onAccentChange={onAccentChange}
                  onThemeChange={onThemeChange}
                  theme={theme}
                />
              </div>
            </details>
            <Link className={styles.primaryAction} to={navigation.newSession}>
              <NewSessionIcon />
              <span>{t("sidebarNewSession")}</span>
            </Link>
          </div>
        </header>

        <div className={styles.canvas}>
          <section className={styles.statePanel} data-state={shellState.kind}>
            <span className={styles.stateIcon}>
              <StateIcon kind={shellState.kind} />
            </span>
            <div
              aria-live="polite"
              role={shellState.kind === "error" ? "alert" : "status"}
            >
              <p className={styles.stateKicker}>{stateCopy.status}</p>
              <h2>{stateCopy.title}</h2>
              <p className={styles.stateBody}>{stateCopy.body}</p>
            </div>
            <Link className={styles.secondaryAction} to={navigation.sessions}>
              <SessionsIcon />
              <span>{t("cockpitOpenClassic")}</span>
            </Link>
          </section>
        </div>
      </section>
    </main>
  );
}

export function CockpitPage() {
  const runtime = useCurrentSourceRuntime();
  const basePath = useRemoteBasePath();
  // Subscribe to the derived primitive only: getSnapshot() returns a fresh
  // object on every call, which makes useSyncExternalStore loop forever
  // (React error 185). useActivityBusState selects `.state` for the same reason.
  const shellKind = useSyncExternalStore(
    (listener) => runtime.transport.status.subscribe(listener),
    () => deriveCockpitShellState(runtime.transport.status.getSnapshot()).kind,
    () => deriveCockpitShellState(runtime.transport.status.getSnapshot()).kind,
  );
  const appearance = useCockpitAppearance();

  return (
    <CockpitShell
      accent={appearance.accent}
      basePath={basePath}
      onAccentChange={appearance.setAccent}
      onThemeChange={appearance.setTheme}
      resolvedTheme={appearance.resolvedTheme}
      shellState={{ kind: shellKind }}
      theme={appearance.theme}
    />
  );
}
