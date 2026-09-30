/**
 * Favourite project folders of the Cockpit's new-session page.
 *
 * Each favourite is a folder on the server host with a short label of the
 * user's choosing ("SZ OS" for `~/Projects/Smartzone OS`). They live in the
 * server settings, so every device of the same host shows the same list.
 * The folder is kept as a path, not a project id: a favourite may name a
 * folder that has never held a session yet.
 */

export interface CockpitProjectFavorite {
  /** Folder on the server host; `~` is left for the server to expand. */
  path: string;
  /** Short name shown on the favourite's button. */
  label: string;
}

export const MAX_COCKPIT_PROJECT_FAVORITES = 24;
export const MAX_COCKPIT_PROJECT_FAVORITE_LABEL_LENGTH = 40;
export const MAX_COCKPIT_PROJECT_FAVORITE_PATH_LENGTH = 4096;

/**
 * The favourites a stored or submitted value describes. Entries without a
 * usable path or label are dropped, labels are trimmed and shortened, the
 * first entry for a path wins and the list is capped. Anything that is not
 * an array yields null, so a caller can refuse it.
 */
export function normalizeCockpitProjectFavorites(
  value: unknown,
): CockpitProjectFavorite[] | null {
  if (!Array.isArray(value)) return null;
  const seen = new Set<string>();
  const favorites: CockpitProjectFavorite[] = [];
  for (const entry of value) {
    if (favorites.length >= MAX_COCKPIT_PROJECT_FAVORITES) break;
    if (typeof entry !== "object" || entry === null) continue;
    const { path, label } = entry as Record<string, unknown>;
    if (typeof path !== "string" || typeof label !== "string") continue;
    const trimmedPath = path.trim();
    const trimmedLabel = label
      .trim()
      .slice(0, MAX_COCKPIT_PROJECT_FAVORITE_LABEL_LENGTH)
      .trim();
    if (
      !trimmedPath ||
      !trimmedLabel ||
      trimmedPath.length > MAX_COCKPIT_PROJECT_FAVORITE_PATH_LENGTH ||
      trimmedPath.includes("\0") ||
      seen.has(trimmedPath)
    ) {
      continue;
    }
    seen.add(trimmedPath);
    favorites.push({ path: trimmedPath, label: trimmedLabel });
  }
  return favorites;
}
