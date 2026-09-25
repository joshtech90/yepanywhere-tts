import type {
  CockpitCatalogProject,
  CockpitCatalogSession,
  CockpitCatalogView,
} from "./catalog";

export interface CockpitFavoriteSession {
  session: CockpitCatalogSession;
  projectName: string;
}

export interface CockpitCatalogSections {
  favorites: CockpitFavoriteSession[];
  projects: CockpitCatalogProject[];
}

/**
 * Favourites lead the sidebar as one flat list across projects; every other
 * session stays in its project group. A group that only held favourites
 * disappears instead of showing as empty.
 */
export function splitCockpitFavorites(
  catalog: CockpitCatalogView,
): CockpitCatalogSections {
  const favorites: CockpitFavoriteSession[] = [];
  const projects: CockpitCatalogProject[] = [];
  for (const project of catalog.projects) {
    const rest = project.sessions.filter((session) => {
      if (!session.pinned) return true;
      favorites.push({ session, projectName: project.name });
      return false;
    });
    if (rest.length === project.sessions.length) {
      projects.push(project);
    } else if (rest.length > 0) {
      projects.push({ ...project, sessions: rest });
    }
  }
  return { favorites, projects };
}

function activityMs(value: string | undefined): number {
  if (!value) return Number.NEGATIVE_INFINITY;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? Number.NEGATIVE_INFINITY : parsed;
}

/** All sessions of a catalogue as one list, most recent activity first. */
export function flattenCockpitCatalog(
  catalog: CockpitCatalogView,
): CockpitFavoriteSession[] {
  return catalog.projects
    .flatMap((project) =>
      project.sessions.map((session) => ({
        session,
        projectName: project.name,
      })),
    )
    .sort(
      (left, right) =>
        activityMs(right.session.lastActivityAt) -
          activityMs(left.session.lastActivityAt) ||
        left.session.key.localeCompare(right.session.key),
    );
}
