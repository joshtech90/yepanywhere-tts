/**
 * Read/unread state carried by the `session-seen` activity event. A nonempty
 * timestamp means the session was read at that time; the empty timestamp means
 * it was explicitly marked unread again.
 */
export const SESSION_UNREAD_TIMESTAMP = "";

/** Whether a `session-seen` event marks the session unread rather than read. */
export function isSessionUnreadEvent(event: { timestamp: string }): boolean {
  return event.timestamp === SESSION_UNREAD_TIMESTAMP;
}
