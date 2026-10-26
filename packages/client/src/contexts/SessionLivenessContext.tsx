import type { SessionLivenessSnapshot } from "@yep-anywhere/shared";
import { createContext, useContext } from "react";

/**
 * The open session's liveness snapshot, for leaf indicators only. A context
 * rather than a prop: stream progress refreshes the snapshot every 500 ms,
 * which must not re-render the transcript list that sits between the page
 * and its processing indicator. See topics/session-liveness.md.
 */
const SessionLivenessContext = createContext<SessionLivenessSnapshot | null>(
  null,
);

export const SessionLivenessProvider = SessionLivenessContext.Provider;

export function useSessionLiveness(): SessionLivenessSnapshot | null {
  return useContext(SessionLivenessContext);
}
