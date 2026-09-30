/** Longest sidebar category name, in UTF-16 code units, after normalizing. */
export const MAX_SIDEBAR_CATEGORY_LENGTH = 60;

/**
 * Canonical form of a user-entered sidebar category name: whitespace runs
 * collapse to one space, the ends are trimmed, and the result is cut to
 * `MAX_SIDEBAR_CATEGORY_LENGTH`. An empty result means "no category".
 */
export function normalizeSidebarCategory(value: string): string | null {
  const normalized = value
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_SIDEBAR_CATEGORY_LENGTH)
    .trim();
  return normalized || null;
}
