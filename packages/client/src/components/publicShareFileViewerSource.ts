import type { FileContentResponse } from "@yep-anywhere/shared";
import {
  type PublicShareContextValue,
  rewritePublicShareLocalAppLinks,
} from "../contexts/PublicShareContext";
import {
  buildPublicShareFileRoutePath,
  buildPublicShareRawFileApiPath,
  fetchPublicShareRawFileBlob,
} from "../lib/publicShareFiles";
import { fetchPublicShareJsonViaRelay } from "../lib/publicShareRelay";
import type { FileViewerSource } from "./FileViewer";

function rewriteRenderedMarkdownHtml(
  html: string,
  context: PublicShareContextValue,
): string {
  const template = document.createElement("template");
  template.innerHTML = html;
  rewritePublicShareLocalAppLinks(template.content, context);
  return template.innerHTML;
}

export function createPublicShareFileViewerSource(
  context: PublicShareContextValue,
): FileViewerSource {
  return {
    loadFile: async (
      _projectId,
      rawPath,
      highlight,
      lineNumber,
      lineEnd,
      viewMode,
    ) => {
      const query: Record<string, string> = {};
      if (highlight) {
        query.highlight = "true";
      }
      if (lineNumber !== undefined) {
        query.line = String(lineNumber);
      }
      if (lineEnd !== undefined) {
        query.lineEnd = String(lineEnd);
      }
      if (viewMode === "range") {
        query.view = "range";
      }
      return await fetchPublicShareJsonViaRelay<FileContentResponse>({
        relayUrl: context.relayUrl,
        relayUsername: context.relayUsername,
        path: buildPublicShareFileRoutePath(context, "content", rawPath, query),
      });
    },
    getRawFileUrl: () => null,
    fetchRawFileBlob: (fileData, rawPath) =>
      fetchPublicShareRawFileBlob(context, fileData, rawPath),
    createMediaSource: (fileData) => ({
      buildApiPath: (rawPath) =>
        buildPublicShareRawFileApiPath(context, rawPath),
      fetchBlob: (rawPath) =>
        fetchPublicShareRawFileBlob(context, fileData ?? null, rawPath),
    }),
    transformRenderedMarkdownHtml: (html) =>
      rewriteRenderedMarkdownHtml(html, context),
  };
}
