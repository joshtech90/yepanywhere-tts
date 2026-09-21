/**
 * Project captions: a one- or two-sentence description shown beside a
 * project's short name on Projects and in the session breadcrumb tooltip.
 *
 * The server derives the caption from the project directory (README front
 * matter, else a known manifest's description field) and lets the user
 * override it in YA app data. See topics/project-captions.md.
 */

export const MAX_PROJECT_CAPTION_LENGTH = 300;

export type ProjectCaptionSource = "override" | "readme" | "manifest";

export interface ProjectCaption {
  text: string;
  source: ProjectCaptionSource;
}

export interface ProjectCaptionsChangedEvent {
  type: "project-captions-changed";
  projectIds: string[];
  timestamp: string;
}

/**
 * Collapse whitespace and enforce the caption length limit. Returns an empty
 * string for blank input so callers can treat it as "clear the override".
 */
export function normalizeProjectCaption(value: string): string {
  const caption = value.replace(/\s+/g, " ").trim();
  if (caption.length > MAX_PROJECT_CAPTION_LENGTH) {
    throw new RangeError(
      `Project caption must be at most ${MAX_PROJECT_CAPTION_LENGTH} characters`,
    );
  }
  return caption;
}
