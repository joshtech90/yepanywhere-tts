export type CockpitShellState =
  | { kind: "empty" }
  | { kind: "loading" }
  | { kind: "offline" }
  | { kind: "error" };

interface CockpitTransportSnapshot {
  state: "ready" | "connecting" | "reconnecting" | "disconnected";
  channels: readonly { lastError?: string }[];
}

export function deriveCockpitShellState(
  transport: CockpitTransportSnapshot,
): CockpitShellState {
  if (transport.state === "ready") return { kind: "empty" };
  if (
    transport.state === "connecting" ||
    transport.state === "reconnecting"
  ) {
    return { kind: "loading" };
  }

  const hasReportedError = transport.channels.some(
    (channel) => channel.lastError,
  );
  return hasReportedError ? { kind: "error" } : { kind: "offline" };
}
