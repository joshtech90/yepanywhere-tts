export type SessionConnectionBarStatus =
  | "idle"
  | "connected"
  | "connecting"
  | "disconnected";

/**
 * Composer 1px rule. Disconnected is always shown; connected/connecting stay
 * behind developer connection bars. A session stream that is retrying or
 * resubscribing is connecting, not disconnected — including the wait after a
 * frontend-changed resubscribe while the main transport is still ready.
 */
export function getSessionConnectionBarStatus(input: {
  hasSessionUpdateStream: boolean;
  sessionUpdatesConnected: boolean;
  sessionUpdatesResubscribing: boolean;
  showConnectionBars: boolean;
  transportReconnecting: boolean;
}): SessionConnectionBarStatus {
  if (!input.hasSessionUpdateStream) {
    return "idle";
  }
  const raw: SessionConnectionBarStatus = input.sessionUpdatesConnected
    ? "connected"
    : input.sessionUpdatesResubscribing || input.transportReconnecting
      ? "connecting"
      : "disconnected";
  return input.showConnectionBars || raw === "disconnected" ? raw : "idle";
}
