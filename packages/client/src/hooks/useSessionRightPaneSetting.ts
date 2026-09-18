import { useSyncExternalStore } from "react";
import { sessionRightPaneSetting as store } from "../lib/sessionViewerPlacement";

export function useSessionRightPaneSetting() {
  const sessionRightPaneEnabled = useSyncExternalStore(
    store.subscribe,
    store.read,
    store.read,
  );
  return { sessionRightPaneEnabled, setSessionRightPaneEnabled: store.set };
}
