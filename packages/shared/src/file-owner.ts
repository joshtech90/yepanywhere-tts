import type { UrlProjectId } from "./projectId.js";

/**
 * The registered project that owns an allowed absolute file, so an action on
 * that file (such as starting a session about it) targets the file's project
 * rather than the conversation it was linked from.
 */
export interface FileOwnerProject {
  projectId: UrlProjectId;
  projectPath: string;
  /** The file's path inside the project, with `/` separators. */
  relativePath: string;
}

/** `owner` is null when the file lies inside no registered project. */
export interface FileOwnerResponse {
  owner: FileOwnerProject | null;
}
