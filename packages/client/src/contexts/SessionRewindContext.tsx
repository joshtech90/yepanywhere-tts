import { createContext, useContext } from "react";

/**
 * Same-session rewind controls shared by the turn menu, the rewound-group
 * header rows, and the display filter. See topics/session-rewind.md.
 */
export interface SessionRewindContextValue {
  /** Stable turn index N by user-turn render id. */
  turnIndexById: ReadonlyMap<string, number>;
  /** `/clear N` for the turn with this render id: keep it, drop what follows. */
  onClearAfter?: (messageId: string) => void;
  /** `/clear N-1` for this turn and put its prompt back in the composer. */
  onClearReplacing?: (messageId: string) => void;
  /** Rewound groups the user has expanded. */
  expandedRewoundGroups: ReadonlySet<string>;
  toggleRewoundGroup: (groupId: string) => void;
}

const EMPTY_INDEX: ReadonlyMap<string, number> = new Map();
const EMPTY_GROUPS: ReadonlySet<string> = new Set();

const SessionRewindContext = createContext<SessionRewindContextValue>({
  turnIndexById: EMPTY_INDEX,
  expandedRewoundGroups: EMPTY_GROUPS,
  toggleRewoundGroup: () => {},
});

export const SessionRewindProvider = SessionRewindContext.Provider;

export function useSessionRewind(): SessionRewindContextValue {
  return useContext(SessionRewindContext);
}
