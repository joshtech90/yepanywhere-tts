const sources = new Map<string, ReadonlySet<string>>();
export function getSyncedDraftSessionIds(source: string): ReadonlySet<string> {
  return sources.get(source) ?? new Set<string>();
}
export function setSyncedDraftSessionIds(
  source: string,
  ids: ReadonlySet<string>,
): void {
  sources.set(source, ids);
}
