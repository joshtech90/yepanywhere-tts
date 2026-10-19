/**
 * Notifies observers after this document writes the saved-hosts record.
 *
 * The Chrome extension mirrors that record for its background worker, which
 * has no `localStorage` (docs/tactical/151 step 7). Writers stay synchronous;
 * an observer must not write saved hosts back.
 */

const listeners = new Set<() => void>();

export function onSavedHostsWritten(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function notifySavedHostsWritten(): void {
  for (const listener of listeners) {
    try {
      listener();
    } catch {
      /* A mirror failure must not fail the credential write. */
    }
  }
}
