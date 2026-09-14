/**
 * How long a client API request may stay unanswered before it is abandoned.
 *
 * A YA server that accepts the connection and then stops answering — a blocked
 * event loop rather than a dead process — leaves a request pending for as long
 * as the browser allows, and every view gated on that reply waits with it,
 * reaching neither its loaded state nor its error state. The deadline exists to
 * give those views a terminal state, so it is generous: it must sit well above
 * the slowest healthy response, and a request that passes it means the server
 * is not answering rather than merely busy.
 *
 * Both transports use it, so the same screen fails the same way whether it
 * reached the server directly or through the relay.
 */
export const API_REQUEST_DEADLINE_MS = 120_000;

/**
 * The signal a request should carry, honouring a caller that brought its own.
 *
 * A caller passing a signal has taken over cancellation — a long upload, a read
 * the reader can abandon — so it keeps whatever lifetime it chose. Everything
 * else gets the shared deadline.
 */
export function requestDeadlineSignal(
  callerSignal: AbortSignal | null | undefined,
): AbortSignal | undefined {
  if (callerSignal) return callerSignal;
  if (typeof AbortSignal === "undefined" || !AbortSignal.timeout) {
    return undefined;
  }
  return AbortSignal.timeout(API_REQUEST_DEADLINE_MS);
}

/**
 * True when this error is a request that passed the deadline above.
 *
 * `AbortSignal.timeout` aborts with a `DOMException` named `TimeoutError`, and
 * a `DOMException` is not reliably an `instanceof Error` across the runtimes
 * this code runs in, so match the name the platform guarantees.
 */
export function isRequestDeadlineError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { name?: unknown }).name === "TimeoutError"
  );
}
