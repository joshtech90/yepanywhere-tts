/**
 * Stable message identity for Grok transcript rows.
 *
 * Grok stamps every `session/update` notification with a monotonic
 * `_meta.eventId` (`<sessionId>-<n>`) and records that same notification
 * verbatim in the session's `updates.jsonl`. So the live ACP stream and the
 * durable replay observe the same identifier for the same update, and keying a
 * rendered message on it makes the two copies dedup by id instead of
 * double-rendering the turn when a backfill merges mid-session.
 *
 * Text and thinking rows buffer several consecutive chunks into one message;
 * both sides key such a row on the event id of its *first* chunk, which
 * requires the two sides to end a buffered run at the same place. See
 * topics/stream-durable-id-dedup.md.
 */

const GROK_EVENT_UUID_PREFIX = "grok-evt-";

/**
 * Derive a rendered-message uuid from a `session/update` notification's
 * `_meta`. Returns undefined for updates with no event id (older Grok builds),
 * leaving the caller on its own fallback identity.
 */
export function grokEventUuid(meta: unknown): string | undefined {
  if (!meta || typeof meta !== "object" || Array.isArray(meta)) {
    return undefined;
  }
  const eventId = (meta as { eventId?: unknown }).eventId;
  return typeof eventId === "string" && eventId.length > 0
    ? `${GROK_EVENT_UUID_PREFIX}${eventId}`
    : undefined;
}
