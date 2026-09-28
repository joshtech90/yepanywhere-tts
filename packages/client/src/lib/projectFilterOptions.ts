import type { ProjectOption } from "../api/client";

const DAY_MS = 24 * 60 * 60 * 1000;
/** Idle longer than this puts a project below the fold. */
export const PROJECT_FOLD_IDLE_MS = 14 * DAY_MS;
/** A project this small must also be this fresh to stay above the fold. */
export const PROJECT_FOLD_FEW_SESSIONS = 2;
export const PROJECT_FOLD_FEW_IDLE_MS = 3 * DAY_MS;

export interface ProjectFilterGroups {
  current: ProjectOption[];
  older: ProjectOption[];
}

/**
 * Split projects for a filter menu: recently busy projects first, stale or
 * barely-used ones below a fold. Each group is alphabetical, so a known name
 * is still found by scanning.
 */
export function groupProjectsForFilter(
  projects: readonly ProjectOption[],
  sessions: readonly { projectId: string; updatedAt: string }[],
  now: number,
): ProjectFilterGroups {
  const stats = new Map<string, { count: number; latest: number }>();
  for (const session of sessions) {
    const updated = Date.parse(session.updatedAt) || 0;
    const entry = stats.get(session.projectId);
    if (entry) {
      entry.count += 1;
      entry.latest = Math.max(entry.latest, updated);
    } else {
      stats.set(session.projectId, { count: 1, latest: updated });
    }
  }

  const byName = (a: ProjectOption, b: ProjectOption) =>
    a.name.localeCompare(b.name) || a.id.localeCompare(b.id);
  const current: ProjectOption[] = [];
  const older: ProjectOption[] = [];
  for (const project of projects) {
    const entry = stats.get(project.id);
    const idle = entry ? now - entry.latest : Number.POSITIVE_INFINITY;
    const isCurrent =
      entry !== undefined &&
      idle <= PROJECT_FOLD_IDLE_MS &&
      (entry.count > PROJECT_FOLD_FEW_SESSIONS ||
        idle <= PROJECT_FOLD_FEW_IDLE_MS);
    (isCurrent ? current : older).push(project);
  }
  return { current: current.sort(byName), older: older.sort(byName) };
}
