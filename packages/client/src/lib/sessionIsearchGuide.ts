export type SessionIsearchScope = "user" | "all" | "full" | "links";

export interface SessionIsearchGuideState {
  active: boolean;
  scope: SessionIsearchScope;
}

export const SESSION_ISEARCH_GUIDE_EVENT = "yepanywhere:session-isearch-guide";

/**
 * Asks the active message list to open transcript search, the pointer
 * equivalent of the search shortcuts. Dispatch it from the user's tap so the
 * search input can take focus inside that gesture.
 */
export const SESSION_ISEARCH_OPEN_EVENT = "yepanywhere:session-isearch-open";

export function requestSessionIsearchOpen() {
  window.dispatchEvent(new Event(SESSION_ISEARCH_OPEN_EVENT));
}

export function dispatchSessionIsearchGuideState(
  detail: SessionIsearchGuideState,
) {
  window.dispatchEvent(
    new CustomEvent<SessionIsearchGuideState>(SESSION_ISEARCH_GUIDE_EVENT, {
      detail,
    }),
  );
}
