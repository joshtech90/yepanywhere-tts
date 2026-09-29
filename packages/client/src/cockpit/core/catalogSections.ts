import type { CockpitCatalogSession, CockpitCatalogView } from "./catalog";

export interface CockpitFavoriteSession {
  session: CockpitCatalogSession;
  projectName: string;
}

export interface CockpitCatalogSections {
  favorites: CockpitFavoriteSession[];
  others: CockpitFavoriteSession[];
}

/**
 * The sidebar reads by time: favourites first, then every other session,
 * each part newest first, with its project named on the row.
 */
export function splitCockpitFavorites(
  catalog: CockpitCatalogView,
): CockpitCatalogSections {
  const favorites: CockpitFavoriteSession[] = [];
  const others: CockpitFavoriteSession[] = [];
  for (const row of flattenCockpitCatalog(catalog)) {
    (row.session.pinned ? favorites : others).push(row);
  }
  return { favorites, others };
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

/**
 * The open session knows from its transcript that another program is still
 * working, which the summary list cannot see during a quiet command. Only a
 * session the list would call idle is lifted; real states stay.
 */
export function markCockpitSessionWorkingElsewhere(
  catalog: CockpitCatalogView,
  sessionId: string | null,
): CockpitCatalogView {
  if (!sessionId) return catalog;
  let changed = false;
  const projects = catalog.projects.map((project) => {
    const index = project.sessions.findIndex(
      (session) => session.id === sessionId && session.status === "complete",
    );
    if (index < 0) return project;
    changed = true;
    const sessions = [...project.sessions];
    const session = sessions[index];
    if (session) sessions[index] = { ...session, status: "external" };
    return { ...project, sessions };
  });
  return changed ? { ...catalog, projects } : catalog;
}
