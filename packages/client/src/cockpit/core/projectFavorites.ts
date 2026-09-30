import type { CockpitProjectFavorite } from "@yep-anywhere/shared";

/**
 * Favourite project folders of the new-session page (Joscha 30.09.2026):
 * one click picks the folder, a short name of his own says which one. The
 * list itself lives in the server settings; these helpers only derive the
 * next list and match favourites to known projects.
 */

/** A folder spelled without trailing slashes, so both spellings match. */
export function folderKey(path: string): string {
  const trimmed = path.trim();
  return trimmed.length > 1 ? trimmed.replace(/[/\\]+$/, "") : trimmed;
}

/** The last folder name, the first suggestion for a favourite's label. */
export function defaultFavoriteLabel(path: string): string {
  const parts = folderKey(path).split(/[/\\]/).filter(Boolean);
  return parts[parts.length - 1] ?? path;
}

export function findFavorite(
  favorites: readonly CockpitProjectFavorite[],
  path: string,
): CockpitProjectFavorite | undefined {
  const key = folderKey(path);
  return favorites.find((favorite) => folderKey(favorite.path) === key);
}

export function addFavorite(
  favorites: readonly CockpitProjectFavorite[],
  path: string,
  label = defaultFavoriteLabel(path),
): CockpitProjectFavorite[] {
  if (findFavorite(favorites, path)) return [...favorites];
  return [...favorites, { path: folderKey(path), label }];
}

export function removeFavorite(
  favorites: readonly CockpitProjectFavorite[],
  path: string,
): CockpitProjectFavorite[] {
  const key = folderKey(path);
  return favorites.filter((favorite) => folderKey(favorite.path) !== key);
}

export function renameFavorite(
  favorites: readonly CockpitProjectFavorite[],
  path: string,
  label: string,
): CockpitProjectFavorite[] {
  const key = folderKey(path);
  const trimmed = label.trim();
  return favorites.map((favorite) =>
    folderKey(favorite.path) === key && trimmed
      ? { ...favorite, label: trimmed }
      : favorite,
  );
}

/** The known project in a favourite's folder, if a session ever ran there. */
export function projectForFolder<T extends { id: string; path: string }>(
  projects: readonly T[],
  path: string,
): T | undefined {
  const key = folderKey(path);
  return projects.find((project) => folderKey(project.path) === key);
}
