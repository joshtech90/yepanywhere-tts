import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import {
  Link,
  useLocation,
  useParams,
  useSearchParams,
} from "react-router-dom";
import { useCurrentSourceRuntime } from "../contexts/SourceRuntimeContext";
import { useRemoteBasePath } from "../hooks/useRemoteBasePath";
import { useMediaQuery } from "../hooks/useMediaQuery";
import { useI18n } from "../i18n";
import {
  CockpitAppearanceControls,
  type CockpitAppearanceControlsProps,
} from "./CockpitAppearanceControls";
import { CockpitCatalog } from "./CockpitCatalog";
import { CockpitCodexUpdateNotice } from "./CockpitCodexUpdateNotice";
import {
  CockpitHiddenView,
  CockpitProjectsView,
  CockpitSessionsView,
} from "./CockpitListViews";
import {
  CockpitDrawerOpenerProvider,
  CockpitMobileDrawer,
} from "./CockpitMobileDrawer";
import { CockpitNewSession } from "./CockpitNewSession";
import { CockpitQuote } from "./CockpitQuote";
import styles from "./CockpitPage.module.css";
import { CockpitSearchPanel } from "./CockpitSearchPanel";
import { CockpitSessionDetail } from "./CockpitSessionDetail";
import {
  CockpitShortcutButton,
  CockpitShortcutDialog,
} from "./CockpitShortcutHelp";
import type { CockpitResolvedTheme } from "./core/appearance";
import { markCockpitSessionWorkingElsewhere } from "./core/catalogSections";
import {
  clearCockpitReturn,
  createCockpitNavigation,
  rememberCockpitReturn,
} from "./core/navigation";
import {
  deriveCockpitShellState,
  type CockpitShellState,
} from "./core/shellState";
import { useCockpitAppearance } from "./useCockpitAppearance";
import {
  useCockpitCatalog,
  type CockpitCatalogData,
} from "./useCockpitCatalog";
import { useCockpitShortcuts } from "./useCockpitShortcuts";
import { useCockpitSidebarWidth } from "./useCockpitSidebarWidth";
import resizeStyles from "./CockpitSidebarResizeHandle.module.css";
import { useCockpitViewportGeometry } from "./useCockpitViewportGeometry";

function SessionsIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M5 6.5h14M5 12h14M5 17.5h9" />
    </svg>
  );
}

function SearchIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="10.5" cy="10.5" r="6" />
      <path d="m15 15 4.5 4.5" />
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

function HiddenIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M3.5 12s3-6 8.5-6c1.6 0 3 .5 4.2 1.2M20.5 12s-3 6-8.5 6c-1.6 0-3-.5-4.2-1.2" />
      <path d="M9.9 9.9a3 3 0 0 0 4.2 4.2M4 4l16 16" />
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
  catalogData: CockpitCatalogData;
  children?: ReactNode;
  /** Which kind of page the children are; each replaces the home canvas. */
  detailView?: "session" | "new" | "list";
  notice?: ReactNode;
  resolvedTheme: CockpitResolvedTheme;
  shellState: CockpitShellState;
}

export function CockpitShell({
  accent,
  basePath,
  catalogData,
  children,
  detailView = "session",
  notice,
  onAccentChange,
  onThemeChange,
  resolvedTheme,
  shellState,
  theme,
}: CockpitShellProps) {
  const { t } = useI18n();
  const [catalogQuery, setCatalogQuery] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchFocusRequested, setSearchFocusRequested] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const rootRef = useRef<HTMLElement>(null);
  const searchTriggerRef = useRef<HTMLButtonElement>(null);
  const searchFocusReturnRef = useRef<HTMLElement | null>(null);
  const searchWasOpenRef = useRef(false);
  const shortcutTriggerRef = useRef<HTMLButtonElement>(null);
  const shortcutFocusReturnRef = useRef<HTMLElement | null>(null);
  const navigation = useMemo(
    () => createCockpitNavigation(basePath),
    [basePath],
  );
  const viewport = useCockpitViewportGeometry();
  const mobileLayout = useMediaQuery("(max-width: 700px)");
  const location = useLocation();
  // Back in the Cockpit, a way back offered by the settings is spent.
  useEffect(() => clearCockpitReturn(), []);
  // Every navigation, also from inside the drawer, closes the drawer.
  // biome-ignore lint/correctness/useExhaustiveDependencies: location.key is the trigger
  useEffect(() => setDrawerOpen(false), [location.key]);
  const openDrawer = useCallback(() => setDrawerOpen(true), []);
  const closeDrawer = useCallback(() => setDrawerOpen(false), []);
  const sidebarWidth = useCockpitSidebarWidth(
    !mobileLayout,
    t("cockpitSidebarResize"),
  );
  const openSearch = useCallback(
    (focusInput: boolean, focusOrigin: HTMLElement | null) => {
      // Without a visible origin the close effect picks the target: the
      // session's menu button on a phone, otherwise the search button.
      searchFocusReturnRef.current =
        focusOrigin?.isConnected === true ? focusOrigin : null;
      setSearchFocusRequested(focusInput);
      setSearchOpen(true);
    },
    [],
  );
  const closeSearch = useCallback(() => {
    setSearchOpen(false);
    setSearchFocusRequested(false);
  }, []);
  const navigateFromSearch = useCallback(() => {
    searchWasOpenRef.current = false;
    searchFocusReturnRef.current = null;
    setSearchOpen(false);
    setSearchFocusRequested(false);
  }, []);
  const openSearchFromShortcut = useCallback(
    (focusOrigin: HTMLElement | null) => openSearch(true, focusOrigin),
    [openSearch],
  );
  const openShortcuts = useCallback((focusOrigin: HTMLElement | null) => {
    shortcutFocusReturnRef.current =
      focusOrigin?.isConnected === true
        ? focusOrigin
        : shortcutTriggerRef.current;
    setShortcutsOpen(true);
  }, []);
  const openShortcutsFromShortcut = useCallback(
    (focusOrigin: HTMLElement | null) => openShortcuts(focusOrigin),
    [openShortcuts],
  );
  const closeShortcuts = useCallback(() => {
    setShortcutsOpen(false);
  }, []);
  useEffect(() => {
    if (searchOpen) {
      searchWasOpenRef.current = true;
      return;
    }
    if (!searchWasOpenRef.current) return;
    searchWasOpenRef.current = false;
    const focusTarget = searchFocusReturnRef.current;
    searchFocusReturnRef.current = null;
    // The phone session hides the bottom bar; its header menu button is the
    // visible way back into the navigation.
    const drawerOpener = rootRef.current?.querySelector<HTMLElement>(
      "[data-cockpit-drawer-opener]",
    );
    const destination =
      focusTarget?.isConnected === true
        ? focusTarget
        : (drawerOpener ?? searchTriggerRef.current);
    destination?.focus({ preventScroll: true });
  }, [searchOpen]);
  useCockpitShortcuts({
    drawerOpen,
    navigation,
    onCloseDrawer: closeDrawer,
    onCloseHelp: closeShortcuts,
    onCloseSearch: closeSearch,
    onOpenHelp: openShortcutsFromShortcut,
    onOpenSearch: openSearchFromShortcut,
    rootRef,
    searchOpen,
    shortcutsOpen,
  });
  const hasCatalog = catalogData.catalog.projects.length > 0;
  const hasDetail = children !== undefined && children !== null;
  const destinations: Array<{
    href: string;
    label: string;
    shortLabel: string;
    icon: ReactNode;
    /** Leaves the Cockpit; a new tab keeps the Cockpit open to return to. */
    external?: boolean;
    /** Leaves the Cockpit in the same window, which remembers the way back. */
    leaves?: boolean;
  }> = [
    {
      href: navigation.sessions,
      label: t("sidebarAllSessions"),
      shortLabel: t("cockpitNavShortSessions"),
      icon: <SessionsIcon />,
    },
    {
      href: navigation.projects,
      label: t("sidebarProjects"),
      shortLabel: t("sidebarProjects"),
      icon: <ProjectsIcon />,
    },
    {
      href: navigation.newSession,
      label: t("sidebarNewSession"),
      shortLabel: t("cockpitNavShortNew"),
      icon: <NewSessionIcon />,
    },
    {
      href: navigation.settings,
      // Only the new-tab variant announces a new tab.
      label: mobileLayout ? t("sidebarSettings") : t("cockpitSettingsNewTab"),
      shortLabel: t("cockpitNavShortSettings"),
      icon: <SettingsIcon />,
      // An installed phone app has no tabs: a new window there had no way
      // back to the Cockpit. Phones stay in the window and remember the way.
      external: !mobileLayout,
      leaves: mobileLayout,
    },
  ];
  const leaveCockpit = () => {
    rememberCockpitReturn(`${location.pathname}${location.search}`);
    navigateFromSearch();
  };
  // The open session on a phone: no bottom bar; the header opens a drawer
  // with the navigation and the latest sessions (Joscha 26.09.2026).
  const sessionDrawer =
    mobileLayout && hasDetail && detailView === "session" && !searchOpen;
  // Leaving the phone session (search, wider screen) forgets an open drawer,
  // so it does not reappear on the way back.
  useEffect(() => {
    if (!sessionDrawer) setDrawerOpen(false);
  }, [sessionDrawer]);
  const stateCopy = {
    empty: {
      title: "",
      body: "",
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
      data-session-drawer={sessionDrawer ? "true" : undefined}
      data-keyboard={viewport.keyboardOpen ? "open" : "closed"}
      data-theme={resolvedTheme}
      // A file dropped beside a drop surface would make the browser open it
      // and leave the Cockpit; refuse it instead.
      onDragOver={(event) => {
        if (event.defaultPrevented) return;
        if (!Array.from(event.dataTransfer.types).includes("Files")) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = "none";
      }}
      onDrop={(event) => {
        if (event.defaultPrevented) return;
        if (event.dataTransfer.files.length > 0) event.preventDefault();
      }}
      ref={rootRef}
      style={{ ...viewport.style, ...sidebarWidth.style }}
    >
      <aside
        aria-label={t("cockpitNavigationAria")}
        className={styles.sidebar}
        inert={shortcutsOpen}
      >
        {!mobileLayout && (
          <div className={styles.desktopCatalog}>
            <CockpitCatalog
              basePath={basePath}
              catalog={catalogData.catalog}
              error={catalogData.error}
              hasMore={catalogData.hasMore}
              loading={catalogData.loading}
              onLoadMore={catalogData.loadMore}
              onQueryChange={setCatalogQuery}
              organization={catalogData.organization}
              query={catalogQuery}
            />
          </div>
        )}

        <nav className={styles.navigation}>
          <button
            aria-keyshortcuts="/"
            aria-pressed={searchOpen}
            className={styles.navigationItem}
            onClick={() => openSearch(false, searchTriggerRef.current)}
            ref={searchTriggerRef}
            type="button"
          >
            <span className={styles.icon}>
              <SearchIcon />
            </span>
            <span>{t("cockpitGlobalSearchNav")}</span>
          </button>
          {destinations.map((destination) => (
            <Link
              aria-keyshortcuts={
                destination.href === navigation.newSession ? "N" : undefined
              }
              aria-label={destination.label}
              className={styles.navigationItem}
              key={destination.href}
              onClick={
                destination.external
                  ? undefined
                  : destination.leaves
                    ? leaveCockpit
                    : navigateFromSearch
              }
              rel={destination.external ? "noopener" : undefined}
              target={destination.external ? "_blank" : undefined}
              title={destination.external ? destination.label : undefined}
              to={destination.href}
            >
              <span className={styles.icon}>{destination.icon}</span>
              <span aria-hidden="true" className={styles.labelLong}>
                {destination.external
                  ? t("sidebarSettings")
                  : destination.label}
              </span>
              <span aria-hidden="true" className={styles.labelShort}>
                {destination.shortLabel}
              </span>
            </Link>
          ))}
          <CockpitShortcutButton
            onOpen={() => openShortcuts(shortcutTriggerRef.current)}
            open={shortcutsOpen}
            triggerRef={shortcutTriggerRef}
          />
        </nav>

        <div className={styles.sidebarFooter}>
          <details
            aria-label={t("cockpitAppearanceLabel")}
            className={styles.desktopAppearance}
          >
            <summary>
              <AppearanceIcon />
              <span>{t("cockpitAppearanceLabel")}</span>
            </summary>
            <div className={styles.desktopAppearancePanel}>
              <CockpitAppearanceControls
                accent={accent}
                onAccentChange={onAccentChange}
                onThemeChange={onThemeChange}
                theme={theme}
              />
            </div>
          </details>
          <Link
            className={styles.footerLink}
            onClick={navigateFromSearch}
            to={navigation.hidden}
          >
            <HiddenIcon />
            <span>{t("cockpitHiddenNav")}</span>
          </Link>
        </div>
        {sidebarWidth.handleProps && (
          <div className={resizeStyles.handle} {...sidebarWidth.handleProps} />
        )}
      </aside>

      <CockpitShortcutDialog
        focusReturnRef={shortcutFocusReturnRef}
        onClose={closeShortcuts}
        open={shortcutsOpen}
        triggerRef={shortcutTriggerRef}
      />

      <CockpitMobileDrawer
        label={t("cockpitNavigationAria")}
        onClose={closeDrawer}
        open={drawerOpen && sessionDrawer}
      >
        <div className={styles.drawerHeader}>
          <Link className={styles.drawerTitle} to={navigation.cockpit}>
            Cockpit
          </Link>
          <button
            aria-label={t("cockpitGlobalSearchNav")}
            className={styles.drawerIconButton}
            onClick={() => {
              setDrawerOpen(false);
              openSearch(true, null);
            }}
            title={t("cockpitGlobalSearchNav")}
            type="button"
          >
            <SearchIcon />
          </button>
        </div>
        <nav
          aria-label={t("cockpitNavigationAria")}
          className={styles.drawerNav}
        >
          {destinations.map((destination) => (
            <Link
              className={styles.drawerItem}
              key={destination.href}
              onClick={destination.leaves ? leaveCockpit : undefined}
              to={destination.href}
            >
              <span className={styles.icon}>{destination.icon}</span>
              <span>{destination.label}</span>
            </Link>
          ))}
          <Link className={styles.drawerItem} to={navigation.hidden}>
            <span className={styles.icon}>
              <HiddenIcon />
            </span>
            <span>{t("cockpitHiddenNav")}</span>
          </Link>
        </nav>
        <div className={styles.drawerCatalog}>
          <CockpitCatalog
            basePath={basePath}
            catalog={catalogData.catalog}
            error={catalogData.error}
            hasMore={catalogData.hasMore}
            loading={catalogData.loading}
            onLoadMore={catalogData.loadMore}
            onQueryChange={setCatalogQuery}
            organization={catalogData.organization}
            query={catalogQuery}
          />
        </div>
      </CockpitMobileDrawer>

      <section
        aria-labelledby={hasDetail || searchOpen ? undefined : "cockpit-title"}
        className={styles.workspace}
        inert={shortcutsOpen}
      >
        {notice}
        <header className={styles.header} hidden={hasDetail || searchOpen}>
          <h1 id="cockpit-title">Cockpit</h1>
          <div className={styles.headerActions}>
            <span
              className={styles.connectionStatus}
              data-state={shellState.kind}
            >
              <span aria-hidden="true" />
              {stateCopy.status}
            </span>
            <Link
              aria-label={t("cockpitHiddenNav")}
              className={styles.mobileHiddenLink}
              title={t("cockpitHiddenNav")}
              to={navigation.hidden}
            >
              <HiddenIcon />
            </Link>
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
            <Link
              aria-keyshortcuts="N"
              aria-label={t("sidebarNewSession")}
              className={styles.primaryAction}
              to={navigation.newSession}
            >
              <NewSessionIcon />
              <span>{t("sidebarNewSession")}</span>
            </Link>
          </div>
        </header>

        <div
          className={styles.canvas}
          data-view={searchOpen ? "search" : hasDetail ? detailView : "home"}
        >
          {searchOpen ? (
            <CockpitSearchPanel
              basePath={basePath}
              focusOnOpen={searchFocusRequested}
              onClose={closeSearch}
              onNavigate={navigateFromSearch}
            />
          ) : hasDetail ? (
            <CockpitDrawerOpenerProvider
              value={sessionDrawer ? openDrawer : null}
            >
              {children}
            </CockpitDrawerOpenerProvider>
          ) : (
            <>
              {mobileLayout && (
                <div className={styles.mobileCatalog}>
                  <CockpitCatalog
                    basePath={basePath}
                    catalog={catalogData.catalog}
                    error={catalogData.error}
                    hasMore={catalogData.hasMore}
                    loading={catalogData.loading}
                    onLoadMore={catalogData.loadMore}
                    onQueryChange={setCatalogQuery}
                    organization={catalogData.organization}
                    query={catalogQuery}
                  />
                </div>
              )}
              <section
                className={styles.statePanel}
                data-catalog={hasCatalog ? "true" : "false"}
                data-state={shellState.kind}
              >
                {shellState.kind === "empty" ? (
                  // Nothing to report: a line of German literature instead of
                  // an explanation (Joscha 26.09.2026).
                  <CockpitQuote />
                ) : (
                  <>
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
                  </>
                )}
                <Link
                  className={styles.secondaryAction}
                  to={navigation.classicSessions}
                >
                  <SessionsIcon />
                  <span>{t("cockpitOpenClassic")}</span>
                </Link>
              </section>
            </>
          )}
        </div>
      </section>
    </main>
  );
}

function CockpitSourcePage() {
  const runtime = useCurrentSourceRuntime();
  const basePath = useRemoteBasePath();
  const { projectId, sessionId } = useParams<{
    projectId: string;
    sessionId: string;
  }>();
  const [searchParams] = useSearchParams();
  const view = sessionId ? null : searchParams.get("view");
  const newSession = view === "new";
  const listView =
    view === "sessions" || view === "projects" || view === "hidden";
  // Subscribe to the derived primitive only: getSnapshot() returns a fresh
  // object on every call, which makes useSyncExternalStore loop forever
  // (React error 185). useActivityBusState selects `.state` for the same reason.
  const shellKind = useSyncExternalStore(
    (listener) => runtime.transport.status.subscribe(listener),
    () => deriveCockpitShellState(runtime.transport.status.getSnapshot()).kind,
    () => deriveCockpitShellState(runtime.transport.status.getSnapshot()).kind,
  );
  const appearance = useCockpitAppearance();
  const baseCatalogData = useCockpitCatalog(shellKind);
  const [workingElsewhereId, setWorkingElsewhereId] = useState<string | null>(
    null,
  );
  const reportWorkingElsewhere = useCallback(
    (id: string, working: boolean) =>
      setWorkingElsewhereId((current) =>
        working ? id : current === id ? null : current,
      ),
    [],
  );
  const catalogData = useMemo(() => {
    const catalog = markCockpitSessionWorkingElsewhere(
      baseCatalogData.catalog,
      workingElsewhereId,
    );
    return catalog === baseCatalogData.catalog
      ? baseCatalogData
      : { ...baseCatalogData, catalog };
  }, [baseCatalogData, workingElsewhereId]);

  return (
    <CockpitShell
      accent={appearance.accent}
      basePath={basePath}
      catalogData={catalogData}
      onAccentChange={appearance.setAccent}
      onThemeChange={appearance.setTheme}
      resolvedTheme={appearance.resolvedTheme}
      shellState={{ kind: shellKind }}
      theme={appearance.theme}
      notice={<CockpitCodexUpdateNotice basePath={basePath} />}
      detailView={newSession ? "new" : listView ? "list" : "session"}
    >
      {view === "sessions" ? (
        <CockpitSessionsView
          basePath={basePath}
          key={searchParams.get("project") ?? ""}
          organization={catalogData.organization}
          projectId={searchParams.get("project")}
          shellKind={shellKind}
        />
      ) : view === "hidden" ? (
        <CockpitHiddenView
          basePath={basePath}
          organization={catalogData.organization}
          shellKind={shellKind}
        />
      ) : view === "projects" ? (
        <CockpitProjectsView basePath={basePath} />
      ) : newSession ? (
        <CockpitNewSession
          basePath={basePath}
          key={searchParams.get("project") ?? ""}
          projectId={searchParams.get("project")}
        />
      ) : projectId && sessionId ? (
        <CockpitSessionDetail
          basePath={basePath}
          key={`${projectId}\0${sessionId}`}
          onWorkingElsewhereChange={reportWorkingElsewhere}
          projectId={projectId}
          sessionId={sessionId}
          shellKind={shellKind}
        />
      ) : undefined}
    </CockpitShell>
  );
}

export function CockpitPage() {
  const runtime = useCurrentSourceRuntime();
  return <CockpitSourcePage key={runtime.sourceKey} />;
}
