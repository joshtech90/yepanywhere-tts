export interface CockpitNavigation {
  cockpit: string;
  sessions: string;
  projects: string;
  newSession: string;
  settings: string;
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
  };
}
