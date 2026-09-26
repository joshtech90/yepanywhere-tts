export interface CockpitScrollAnchorEntry {
  key: string;
}

/**
 * Returns how many current entries precede the row that was visible before an
 * older-page request. Appended live rows therefore return zero, while a real
 * history prepend returns a positive offset. A missing anchor means the
 * transcript was replaced and must not receive an old height correction.
 */
export function countEntriesBeforeCockpitScrollAnchor(
  anchorKey: string,
  entries: readonly CockpitScrollAnchorEntry[],
): number | null {
  const anchorIndex = entries.findIndex((entry) => entry.key === anchorKey);
  return anchorIndex >= 0 ? anchorIndex : null;
}
