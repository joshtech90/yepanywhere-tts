import { createLocalStorageBoolean } from "./localStorageValue";
import type { SessionViewerRegistration } from "./sessionViewerController";
import { UI_KEYS } from "./storageKeys";

export const sessionRightPaneSetting = createLocalStorageBoolean(
  UI_KEYS.sessionRightPane,
  false,
);

/** Right pane viewers leave the session transcript live beside them. */
export function sessionViewerUsesRightPane(
  viewer: SessionViewerRegistration,
): boolean {
  return (
    viewer.kind === "vhost" ||
    (viewer.kind === "file" &&
      !!viewer.sessionId &&
      !!viewer.supportsRightPane &&
      sessionRightPaneSetting.read())
  );
}
