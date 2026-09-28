/**
 * Public share file routes: which project file a share-relative path names,
 * the relay path that reads it, and the raw-file fetch every share surface
 * uses. React-free, so the standalone play page shares it with the app.
 */
import {
  type FileContentResponse,
  fromUrlProjectId,
  isUrlProjectId,
  parseLineColumn,
} from "@yep-anywhere/shared";
import { getEmbeddedFileMediaBlob } from "./embeddedFileMedia";
import { fetchPublicShareBlobViaRelay } from "./publicShareRelay";
import {
  getProjectRelativePath,
  normalizePathSeparators,
  stripTrailingPathSeparators,
} from "./text";

/** The bearer grant a share file request carries. */
export interface PublicShareFileGrant {
  secret: string;
  viewerId?: string;
}

/** A grant plus the project its relative paths resolve against. */
export interface PublicShareProjectFileGrant extends PublicShareFileGrant {
  projectId: string | null;
}

/** Everything needed to fetch a share file over the relay. */
export interface PublicShareRelayFileGrant extends PublicShareProjectFileGrant {
  relayUrl: string;
  relayUsername: string;
}

/** `content` is the JSON file view; `raw` is the file's bytes. */
export type PublicShareFileRoute = "content" | "raw";

function normalizeRelativePath(filePath: string): string | null {
  const parts: string[] = [];
  for (const part of filePath.replaceAll("\\", "/").split("/")) {
    if (!part || part === ".") {
      continue;
    }
    if (part === "..") {
      if (parts.length === 0) {
        return null;
      }
      parts.pop();
      continue;
    }
    parts.push(part);
  }
  return parts.length > 0 ? parts.join("/") : null;
}

function getProjectRoot(projectId: string | null): string | null {
  if (!projectId || !isUrlProjectId(projectId)) {
    return null;
  }
  try {
    return stripTrailingPathSeparators(fromUrlProjectId(projectId));
  } catch {
    return null;
  }
}

function isLikelyManagedAttachmentPath(filePath: string): boolean {
  return /(?:^|[\\/])projects\/[a-f0-9]{32}\/attachments(?:[\\/]|$)/i.test(
    filePath,
  );
}

/**
 * The share-relative path a written file path names, or null when it leaves
 * the shared project. A `:line` suffix is split off into `lineNumber`.
 */
export function normalizePublicShareFilePath(
  filePath: string,
  projectId: string | null,
): { lineNumber?: number; path: string } | null {
  const parsed = parseLineColumn(filePath);
  const parsedPath = normalizePathSeparators(parsed.path);
  if (isLikelyManagedAttachmentPath(parsedPath)) {
    return { lineNumber: parsed.line, path: parsedPath };
  }
  const projectRoot = getProjectRoot(projectId);
  const projectRelativePath = getProjectRelativePath(parsedPath, projectRoot);
  if (projectRelativePath === ".") {
    return null;
  }
  if (projectRelativePath !== null) {
    const relativePath = normalizeRelativePath(projectRelativePath);
    return relativePath
      ? { lineNumber: parsed.line, path: relativePath }
      : null;
  }
  if (parsedPath.startsWith("/") || /^[a-zA-Z]:\//.test(parsedPath)) {
    return null;
  }

  const relativePath = normalizeRelativePath(parsedPath);
  return relativePath ? { lineNumber: parsed.line, path: relativePath } : null;
}

/**
 * Relay path of a share file route. `sharePath` must already be
 * share-relative (see `normalizePublicShareFilePath`); `query` follows the
 * path and viewer parameters.
 */
export function buildPublicShareFileRoutePath(
  grant: PublicShareFileGrant,
  route: PublicShareFileRoute,
  sharePath: string,
  query: Record<string, string> = {},
): string {
  const params = new URLSearchParams({ path: sharePath });
  if (grant.viewerId) params.set("viewerId", grant.viewerId);
  for (const [name, value] of Object.entries(query)) params.set(name, value);
  const suffix = route === "raw" ? "/raw" : "";
  return `/public-api/shares/${encodeURIComponent(grant.secret)}/files${suffix}?${params}`;
}

/** Raw-file relay path for a written file path; null outside the share. */
export function buildPublicShareRawFileApiPath(
  grant: PublicShareProjectFileGrant,
  filePath: string,
): string | null {
  const normalized = normalizePublicShareFilePath(filePath, grant.projectId);
  return normalized
    ? buildPublicShareFileRoutePath(grant, "raw", normalized.path)
    : null;
}

/**
 * A file's bytes as a share viewer sees them: media the server embedded in
 * `fileData` (the document that references the file) needs no request;
 * anything else is read through the share's raw route.
 */
export async function fetchPublicShareRawFileBlob(
  grant: PublicShareRelayFileGrant,
  fileData: FileContentResponse | null,
  filePath: string,
): Promise<Blob> {
  const normalized = normalizePublicShareFilePath(filePath, grant.projectId);
  const embedded = fileData
    ? ((normalized
        ? getEmbeddedFileMediaBlob(fileData, normalized.path)
        : null) ?? getEmbeddedFileMediaBlob(fileData, filePath))
    : null;
  if (embedded) {
    return embedded;
  }
  if (!normalized) {
    throw new Error("File is outside this public share");
  }
  return await fetchPublicShareBlobViaRelay({
    relayUrl: grant.relayUrl,
    relayUsername: grant.relayUsername,
    path: buildPublicShareFileRoutePath(grant, "raw", normalized.path),
  });
}
