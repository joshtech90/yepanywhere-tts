export interface CockpitNavigation {
  cockpit: string;
  sessions: string;
  projects: string;
  /** The established session list, for leaving the Cockpit on purpose. */
  classicSessions: string;
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
