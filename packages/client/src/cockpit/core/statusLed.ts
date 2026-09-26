import type { CockpitSessionStatus } from "./catalog";
import type { CockpitSessionState } from "./sessionDetail";

/**
 * One colour language for every session dot: grey rests, green works (also in
 * another program), amber waits for the user, red failed, and a hollow ring
 * means the Cockpit cannot currently see the session.
 */
export type CockpitLedTone =
  | "idle"
  | "working"
  | "waiting"
  | "error"
  | "unknown";

export function cockpitLedToneForStatus(
  status: CockpitSessionStatus,
): CockpitLedTone {
  switch (status) {
    case "active":
    case "external":
      return "working";
    case "approval":
    case "question":
      return "waiting";
    case "error":
      return "error";
    case "offline":
      return "unknown";
    case "complete":
      return "idle";
  }
}

export function cockpitLedToneForState(
  state: CockpitSessionState,
): CockpitLedTone {
  switch (state) {
    case "active":
    case "external":
      return "working";
    case "waiting":
      return "waiting";
    case "error":
      return "error";
    case "offline":
    case "reconnecting":
      return "unknown";
    case "complete":
      return "idle";
  }
}
