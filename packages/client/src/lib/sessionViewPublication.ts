import {
  SESSION_VIEW_LIMITS,
  type SessionViewViewer,
} from "@yep-anywhere/shared";
import type { ProjectAppTarget } from "../api/projectApp";
import type { SessionViewerControllerState } from "./sessionViewerController";
import { sessionViewerUsesRightPane } from "./sessionViewerPlacement";

export interface ProjectAppView {
  target: ProjectAppTarget | undefined;
  full: boolean;
  openedBy: "session" | "user";
}

/**
 * Addresses go to the agent without query or fragment: YA adds app bearers
 * there, and the origin and path already identify what is shown.
 */
function address(url: string): string {
  try {
    const parsed = new URL(url);
    parsed.search = "";
    parsed.hash = "";
    return parsed.href.slice(0, SESSION_VIEW_LIMITS.target);
  } catch {
    return url.split(/[?#]/, 1)[0]?.slice(0, SESSION_VIEW_LIMITS.target) ?? "";
  }
}

function controllerViewer(
  viewer: SessionViewerControllerState,
): SessionViewViewer {
  const common = {
    label: viewer.label.slice(0, SESSION_VIEW_LIMITS.label),
    openedBy: viewer.openedBy ?? "user",
    state: viewer.minimized ? "minimized" : "open",
    placement: sessionViewerUsesRightPane(viewer) ? "right-pane" : "covering",
  } as const;
  switch (viewer.kind) {
    case "vhost":
      return {
        ...common,
        kind: viewer.artifactToken ? "artifact" : "app",
        target: address(viewer.sourceUrl ?? viewer.url),
        url: address(viewer.url),
      };
    case "artifact":
      return {
        ...common,
        kind: "artifact",
        target: address(viewer.url),
        url: address(viewer.url),
      };
    case "file":
      return {
        ...common,
        kind: "file",
        target: `${viewer.filePath}${viewer.lineSuffix}`.slice(
          0,
          SESSION_VIEW_LIMITS.target,
        ),
      };
    case "panel":
      return { ...common, kind: "panel", target: null };
  }
}

/** What this tab shows beside `sessionId`, in the order a reader sees it. */
export function sessionViewViewers(
  sessionId: string,
  controller: SessionViewerControllerState | null,
  projectApp: ProjectAppView | null,
): SessionViewViewer[] {
  const viewers: SessionViewViewer[] = [];
  if (projectApp)
    viewers.push({
      kind: "project-app",
      label: "Project app",
      target:
        projectApp.target?.target === "artifact" && projectApp.target.artifactId
          ? `artifact:${projectApp.target.artifactId}`
          : "app",
      openedBy: projectApp.openedBy,
      state: "open",
      placement: projectApp.full ? "full-view" : "right-pane",
    });
  if (controller?.sessionId === sessionId)
    viewers.push(controllerViewer(controller));
  return viewers;
}
