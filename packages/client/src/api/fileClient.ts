import type { FileContentResponse } from "@yep-anywhere/shared";
import { fetchJSON } from "./sourceApiFetch";

/**
 * Project raw-file API path: the original bytes of a project file, as an
 * attachment when `download` is set. Source transports take it after
 * `toSourceTransportApiPath`.
 */
export function projectRawFileApiPath(
  projectId: string,
  path: string,
  download = false,
): string {
  const params = new URLSearchParams({ path });
  if (download) params.set("download", "true");
  return `/api/projects/${encodeURIComponent(projectId)}/files/raw?${params.toString()}`;
}

export const fileApi = {
  getFile: (
    projectId: string,
    path: string,
    highlight = false,
    lineNumber?: number,
    lineEnd?: number,
    viewMode?: "full" | "range",
  ) => {
    const params = new URLSearchParams({ path });
    if (highlight) params.set("highlight", "true");
    if (lineNumber !== undefined) params.set("line", String(lineNumber));
    if (lineEnd !== undefined) params.set("lineEnd", String(lineEnd));
    if (viewMode === "range") params.set("view", "range");
    return fetchJSON<FileContentResponse>(
      `/projects/${projectId}/files?${params.toString()}`,
    );
  },

  /** Metadata only, for freshness checks; the server reads no content. */
  getFileMetadata: (projectId: string, path: string) => {
    const params = new URLSearchParams({ path, metadata: "only" });
    return fetchJSON<FileContentResponse>(
      `/projects/${projectId}/files?${params.toString()}`,
    );
  },

  getFileRawUrl: projectRawFileApiPath,

  /**
   * Expand diff context to show full file.
   * Returns syntax-highlighted diff with the entire file as context.
   * Uses originalFile from SDK Edit result (never truncated, verified up to 150KB+).
   */
  expandDiffContext: (
    projectId: string,
    filePath: string,
    oldString: string,
    newString: string,
    originalFile: string,
  ) =>
    fetchJSON<{
      structuredPatch: Array<{
        oldStart: number;
        oldLines: number;
        newStart: number;
        newLines: number;
        lines: string[];
      }>;
      diffHtml: string;
    }>(`/projects/${projectId}/diff/expand`, {
      method: "POST",
      body: JSON.stringify({ filePath, oldString, newString, originalFile }),
    }),
};
