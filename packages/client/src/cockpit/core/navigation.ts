export interface CockpitNavigation {
  cockpit: string;
  sessions: string;
  projects: string;
  newSession: string;
  settings: string;
  project: (projectId: string) => string;
  session: (projectId: string, sessionId: string) => string;
  classicSession: (projectId: string, sessionId: string) => string;
}

function withBasePath(basePath: string, path: string): string {
  return `${basePath.replace(/\/$/, "")}${path}`;
}

/**
 * The Cockpit owns its presentation, while the existing router remains the
 * source of truth for application and relay paths.
 */
export function createCockpitNavigation(basePath: string): CockpitNavigation {
  return {
    cockpit: withBasePath(basePath, "/cockpit"),
    sessions: withBasePath(basePath, "/sessions"),
    projects: withBasePath(basePath, "/projects"),
    newSession: withBasePath(basePath, "/new-session"),
    settings: withBasePath(basePath, "/settings"),
    project: (projectId) =>
      withBasePath(basePath, `/projects/${encodeURIComponent(projectId)}`),
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
