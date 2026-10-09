/**
 * What one browser tab shows beside a session, published so the session's
 * agent can ask which app, artifact or file the user has open.
 *
 * Contract: topics/agent-self.md § View inspection.
 */

export const SESSION_VIEW_KINDS = [
  "app",
  "artifact",
  "file",
  "panel",
  "project-app",
] as const;
export type SessionViewKind = (typeof SESSION_VIEW_KINDS)[number];

export const SESSION_VIEW_LIMITS = {
  clientId: 128,
  device: 64,
  label: 200,
  target: 2048,
  viewers: 4,
} as const;

export interface SessionViewViewer {
  kind: SessionViewKind;
  label: string;
  /**
   * What the viewer shows in the agent's terms: the loopback URL the agent
   * printed, the artifact link, the file path with any line suffix, or the
   * project app target. Null when there is no addressable target (a panel).
   */
  target: string | null;
  /** The browser-facing address, without query or fragment. */
  url?: string;
  /** A fresh tool announcement or turn-end app update, or a user gesture. */
  openedBy: "session" | "user";
  state: "open" | "minimized";
  placement: "right-pane" | "covering" | "full-view";
}

/** The body a tab sends for the session it is showing. */
export interface SessionViewPublication {
  /** Per-tab identity; two tabs in one browser are separate clients. */
  clientId: string;
  /** Coarse device label, such as "Mac" or "Android". */
  device: string;
  /** The tab is visible and has keyboard focus. */
  focused: boolean;
  viewers: SessionViewViewer[];
}

/** One client's view as the server recorded it. */
export interface SessionClientView extends SessionViewPublication {
  publishedAt: string;
  /** Last publication that reported focus; null when never focused. */
  focusedAt: string | null;
}

function boundedString(input: unknown, limit: number): input is string {
  return typeof input === "string" && input.length <= limit;
}

function parseViewer(input: unknown): SessionViewViewer | null {
  if (!input || typeof input !== "object") return null;
  const viewer = input as Record<string, unknown>;
  if (
    !SESSION_VIEW_KINDS.includes(viewer.kind as SessionViewKind) ||
    !boundedString(viewer.label, SESSION_VIEW_LIMITS.label) ||
    !(
      viewer.target === null ||
      boundedString(viewer.target, SESSION_VIEW_LIMITS.target)
    ) ||
    !(
      viewer.url === undefined ||
      boundedString(viewer.url, SESSION_VIEW_LIMITS.target)
    ) ||
    (viewer.openedBy !== "session" && viewer.openedBy !== "user") ||
    (viewer.state !== "open" && viewer.state !== "minimized") ||
    !["right-pane", "covering", "full-view"].includes(String(viewer.placement))
  )
    return null;
  return {
    kind: viewer.kind as SessionViewKind,
    label: viewer.label,
    target: viewer.target as string | null,
    ...(viewer.url !== undefined ? { url: viewer.url as string } : {}),
    openedBy: viewer.openedBy,
    state: viewer.state,
    placement: viewer.placement as SessionViewViewer["placement"],
  };
}

/** Exact-shape parse; extra fields are dropped and anything malformed is null. */
export function parseSessionViewPublication(
  input: unknown,
): SessionViewPublication | null {
  if (!input || typeof input !== "object") return null;
  const body = input as Record<string, unknown>;
  if (
    !boundedString(body.clientId, SESSION_VIEW_LIMITS.clientId) ||
    body.clientId.length === 0 ||
    !boundedString(body.device, SESSION_VIEW_LIMITS.device) ||
    typeof body.focused !== "boolean" ||
    !Array.isArray(body.viewers) ||
    body.viewers.length > SESSION_VIEW_LIMITS.viewers
  )
    return null;
  const viewers: SessionViewViewer[] = [];
  for (const item of body.viewers) {
    const viewer = parseViewer(item);
    if (!viewer) return null;
    viewers.push(viewer);
  }
  return {
    clientId: body.clientId,
    device: body.device,
    focused: body.focused,
    viewers,
  };
}

export function isSessionClientView(
  input: unknown,
): input is SessionClientView {
  if (!parseSessionViewPublication(input)) return false;
  const view = input as Record<string, unknown>;
  return (
    typeof view.publishedAt === "string" &&
    (view.focusedAt === null || typeof view.focusedAt === "string")
  );
}
