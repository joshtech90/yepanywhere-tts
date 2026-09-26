export interface CockpitScheduledTranscriptEntry {
  key: string;
}

/**
 * Keeps append/tail updates on React's deferred transcript lane while making
 * prefix changes immediate. Older-page insertion, trimming, and replacement
 * must commit with their scroll-anchor bookkeeping instead of lagging behind.
 */
export function selectCockpitTranscriptSnapshot<
  Entry extends CockpitScheduledTranscriptEntry,
>(current: readonly Entry[], deferred: readonly Entry[]): readonly Entry[] {
  if (current === deferred || current.length === 0 || deferred.length === 0) {
    return current;
  }

  const deferredFirstKey = deferred[0]?.key;
  if (
    !deferredFirstKey ||
    current.length < deferred.length ||
    current[0]?.key !== deferredFirstKey
  ) {
    return current;
  }

  return deferred;
}
