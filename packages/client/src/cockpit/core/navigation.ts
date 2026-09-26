export interface CockpitNavigation {
  cockpit: string;
  sessions: string;
  projects: string;
  /** The established session list, for leaving the Cockpit on purpose. */
  classicSessions: string;
  hidden: string;
  newSession: string;
  newSessionIn: (projectId: string) => string;
  settings: string;
  project: (projectId: string) => string;
  session: (projectId: string, sessionId: string) => string;
  classicSession: (projectId: string, sessionId: string) => string;
}

function withBasePath(basePath: string, path: string): string {
  return `${basePath.replace(/\/$/, "")}${path}`;
}

export function isCockpitPathname(pathname: string): boolean {
  return (
    pathname === "/cockpit" ||
    pathname.startsWith("/cockpit/") ||
    /^\/-\/relay\/[^/]+\/cockpit(?:\/|$)/.test(pathname)
  );
}

/**
 * The Cockpit owns its presentation, while the existing router remains the
 * source of truth for application and relay paths.
 */
export function createCockpitNavigation(basePath: string): CockpitNavigation {
  return {
    cockpit: withBasePath(basePath, "/cockpit"),
    sessions: withBasePath(basePath, "/cockpit?view=sessions"),
    projects: withBasePath(basePath, "/cockpit?view=projects"),
    classicSessions: withBasePath(basePath, "/sessions"),
    hidden: withBasePath(basePath, "/cockpit?view=hidden"),
    newSession: withBasePath(basePath, "/cockpit?view=new"),
    newSessionIn: (projectId) =>
      withBasePath(
        basePath,
        `/cockpit?view=new&project=${encodeURIComponent(projectId)}`,
      ),
    settings: withBasePath(basePath, "/settings"),
    project: (projectId) =>
      withBasePath(
        basePath,
        `/cockpit?view=sessions&project=${encodeURIComponent(projectId)}`,
      ),
    session: (projectId, sessionId) =>
      withBasePath(
        basePath,
        `/cockpit/projects/${encodeURIComponent(
          projectId,
        )}/sessions/${encodeURIComponent(sessionId)}`,
      ),
    classicSession: (projectId, sessionId) =>
      withBasePath(
        basePath,
        `/projects/${encodeURIComponent(projectId)}/sessions/${encodeURIComponent(
          sessionId,
        )}`,
      ),
  };
}

/**
 * On a phone the settings open in the same window, and the existing settings
 * page knows nothing of the Cockpit. The Cockpit remembers where it was, so
 * the settings page can offer the way back (Joscha 26.09.2026: from the old
 * settings there was no return without closing the app).
 */
const COCKPIT_RETURN_KEY = "yep-anywhere-cockpit-return";

export interface CockpitReturnTarget {
  path: string;
  /** react-router's history index of the Cockpit entry, when known. */
  index: number | null;
}

function historyIndex(): number | null {
  const index = (window.history.state as { idx?: unknown } | null)?.idx;
  return typeof index === "number" ? index : null;
}

export function rememberCockpitReturn(path: string): void {
  try {
    sessionStorage.setItem(
      COCKPIT_RETURN_KEY,
      JSON.stringify({ path, index: historyIndex() }),
    );
  } catch {
    // Without storage the settings simply show no way back.
  }
}

export function readCockpitReturn(): CockpitReturnTarget | null {
  try {
    const raw = sessionStorage.getItem(COCKPIT_RETURN_KEY);
    if (!raw) return null;
    const value = JSON.parse(raw) as Partial<CockpitReturnTarget>;
    if (
      typeof value.path !== "string" ||
      !isCockpitPathname(value.path.split("?")[0] ?? "")
    ) {
      return null;
    }
    return {
      path: value.path,
      index: typeof value.index === "number" ? value.index : null,
    };
  } catch {
    return null;
  }
}

export function clearCockpitReturn(): void {
  try {
    sessionStorage.removeItem(COCKPIT_RETURN_KEY);
  } catch {
    // Nothing to clear.
  }
}

/**
 * Steps back through history when the Cockpit entry is still behind the
 * current page, so the back gesture afterwards does not land in the settings
 * again; otherwise replaces the settings entry with the Cockpit.
 */
export function returnToCockpit(
  target: CockpitReturnTarget,
  navigate: (path: string, options: { replace: boolean }) => void,
): void {
  clearCockpitReturn();
  const current = historyIndex();
  if (target.index !== null && current !== null && current > target.index) {
    window.history.go(target.index - current);
    return;
  }
  navigate(target.path, { replace: true });
}
