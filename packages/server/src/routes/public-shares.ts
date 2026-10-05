import {
  DEFAULT_RELAY_URL,
  PUBLIC_SHARE_INITIAL_PROMPT_MAX_LENGTH,
  PUBLIC_SHARE_MEDIA_ASSET_EXTENSIONS,
  PUBLIC_SHARE_SESSION_CHUNKS_CAPABILITY,
  type AppSession,
  type CreatePublicSessionShareRequest,
  type CreatePublicSessionShareResponse,
  type FileContentResponse,
  type FreezePublicSessionLiveSharesResponse,
  type PublicSessionShareResponse,
  type PublicSessionShareSessionStatusResponse,
  type PublicSessionShareViewerActionResponse,
  type RevokePublicSessionSharesResponse,
  type LinkedSite,
  type UrlProjectId,
  isUrlProjectId,
  normalizeRelayUrl,
  parseLineColumn,
} from "@yep-anywhere/shared";
import { basename, dirname, extname, posix, win32 } from "node:path";
import type { Context } from "hono";
import { Hono } from "hono";
import {
  decodeProjectId,
  getProjectName,
  type ProjectDisplayNameResolver,
} from "../projects/paths.js";
import { tryClaimProjectPathIndex } from "../projects/projectPathIndex.js";
import type { RelayClientStatus } from "../services/RelayClientService.js";
import {
  PublicShareCaptureError,
  PublicShareChunkCursorError,
  type PublicShareCapture,
  type PublicShareService,
} from "../services/PublicShareService.js";
import { augmentProjectPathLinksInMessage } from "../augments/finalized-message-augmenter.js";
import { augmentTextBlocks } from "../augments/markdown-augments.js";
import { renderLocalFileLinkOpen } from "../augments/safe-markdown.js";
import { augmentEditToolUses } from "../sessions/persisted-augments.js";
import type { Message } from "../supervisor/types.js";
import {
  cachedLinkedSite,
  MAX_LINKED_DOCUMENT_BYTES,
  readLinkedDocument,
} from "../utils/linkedSiteCache.js";
import {
  openProjectRelativeFile,
  readFileHandleBounded,
} from "../utils/projectFileAccess.js";
import type { createLocalResourcePathPolicy } from "./local-resource-policy.js";
import {
  legacyPublicShareResponseStream,
  serializeLegacyJsonValue,
  serializeLegacyPublicShareResponse,
} from "./public-share-json-stream.js";
import { canonicalizeManagedAttachmentPath } from "../uploads/attachmentAccess.js";
import {
  buildPublicShareViewerUrl,
  getDefaultPublicShareViewerBaseUrl,
  getDefaultYaClientBaseUrl,
  resolvePublicShareViewerBaseUrl,
  resolveYaClientBaseUrl,
} from "../utils/publicShareViewerUrl.js";
import { createUntrustedFileResponseHeaders } from "./untrusted-file-response.js";

export interface RelayConfigForPublicShare {
  url: string;
  username: string;
}

export interface PublicSharePublicRoutesDeps {
  publicShareService: PublicShareService;
  loadSession: (
    projectId: UrlProjectId,
    sessionId: string,
    options?: { afterMessageId?: string },
  ) => Promise<AppSession | null>;
  loadSessionUpdatedAt?: (
    projectId: UrlProjectId,
    sessionId: string,
  ) => Promise<string | null>;
  loadSessionSummary?: (
    projectId: UrlProjectId,
    sessionId: string,
  ) => Promise<Pick<
    AppSession,
    | "customTitle"
    | "fullTitle"
    | "initialPrompt"
    | "provider"
    | "title"
    | "updatedAt"
  > | null>;
  getRelayConfig?: () => RelayConfigForPublicShare | null;
  getPublicSharesEnabled?: () => boolean;
  getRemoteAccessEnabled?: () => boolean;
  getRelayStatus?: () => RelayClientStatus | null;
  getYaClientBaseUrl?: () => string | null | undefined;
  /** @deprecated Use getYaClientBaseUrl. */
  getPublicShareViewerBaseUrl?: () => string | null | undefined;
  fetchProjectFile?: (
    projectId: UrlProjectId,
    path: string,
    options: {
      download?: boolean;
      highlight?: boolean;
      lineEnd?: number;
      lineNumber?: number;
      raw?: boolean;
      projectRoot?: string;
      viewMode?: "full" | "range";
    },
  ) => Promise<Response>;
  /** YA data directory; used to authorize app-data attachment paths. */
  dataDir?: string;
  /**
   * The local file policy, for what a live file share's links reach outside
   * its project. Without it, a file share serves only in-project targets.
   */
  localFilePolicy?: Pick<
    ReturnType<typeof createLocalResourcePathPolicy>,
    "resolveAllowedFilePath"
  >;
}

export interface PublicShareRoutesDeps extends PublicSharePublicRoutesDeps {
  loadCompleteSession: (
    projectId: UrlProjectId,
    sessionId: string,
  ) => Promise<AppSession | null>;
  /** Names the shared session's project; defaults to the path's name. */
  projectDisplayName?: ProjectDisplayNameResolver;
}

const PUBLIC_SHARE_RENDER_SOURCE_EXTENSIONS = new Set([
  ".htm",
  ".html",
  ".markdown",
  ".md",
  ".mdx",
  ".qmd",
]);
const MAX_PUBLIC_SHARE_TRANSITIVE_SOURCE_BYTES = 1024 * 1024;

function getPublicShareReadiness(deps: PublicSharePublicRoutesDeps): {
  enabled: boolean;
  relayConfig: RelayConfigForPublicShare | null;
  configured: boolean;
  remoteAccessEnabled: boolean;
  relayStatus: RelayClientStatus | null;
  canCreate: boolean;
} {
  const enabled = deps.getPublicSharesEnabled?.() ?? false;
  const relayConfig = deps.getRelayConfig?.() ?? null;
  const configured = !!relayConfig?.url && !!relayConfig.username;
  const remoteAccessEnabled = deps.getRemoteAccessEnabled?.() ?? false;
  const relayStatus = deps.getRelayStatus?.() ?? null;
  const storageReady = deps.publicShareService.getReadiness().state === "ready";
  return {
    enabled,
    relayConfig,
    configured,
    remoteAccessEnabled,
    relayStatus,
    canCreate: enabled && configured && remoteAccessEnabled && storageReady,
  };
}

/**
 * Render share transcript markdown with the same project-file links the
 * authenticated session shows.
 *
 * The share serves the project files its session mentions, so a path the
 * session names is a path the viewer may open. Only in-project paths the
 * server confirms exist become links: no absolute-path resolver is supplied,
 * which is what keeps files outside the project root plain text.
 */
async function augmentPublicShareMessages(
  messages: Message[],
  projectId: UrlProjectId,
): Promise<void> {
  let projectPath: string;
  try {
    projectPath = decodeProjectId(projectId);
  } catch {
    await Promise.all([
      augmentTextBlocks(messages),
      augmentEditToolUses(messages),
    ]);
    return;
  }

  const pathIndex = await tryClaimProjectPathIndex(projectPath);
  const safeMarkdownOptions = {
    projectFileLinks: {
      projectId,
      projectPath,
      publicShare: true,
      ...(pathIndex ? { index: pathIndex } : {}),
    },
  };
  try {
    await Promise.all([
      augmentTextBlocks(messages, safeMarkdownOptions),
      augmentEditToolUses(messages),
      // Command text, string tool results, and user turns carry their path
      // targets as data rather than markup; the share client turns those into
      // the same share file links.
      ...messages.map((message) =>
        augmentProjectPathLinksInMessage(
          message as unknown as Record<string, unknown>,
          safeMarkdownOptions,
        ).catch(() => {
          // Path links are advisory; a frozen or unreadable message must not
          // fail the share response that carries it.
        }),
      ),
    ]);
  } finally {
    pathIndex?.release();
  }
}

function parsePositiveIntegerQuery(
  value: string | undefined,
): number | undefined {
  if (!value) {
    return undefined;
  }
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

function buildPublicShareUrl(
  secret: string,
  relayConfig: RelayConfigForPublicShare,
  yaClientBaseUrl: string,
): string {
  const url = new URL(buildPublicShareViewerUrl(secret, yaClientBaseUrl));
  const relayUrl = normalizeRelayUrl(relayConfig.url);
  url.searchParams.set("h", relayConfig.username);
  if (relayUrl !== DEFAULT_RELAY_URL) {
    url.searchParams.set("r", relayUrl);
  }
  url.hash = "v=2";
  return url.toString();
}

function publicShareStoreUnavailable(
  c: Context,
  deps: PublicSharePublicRoutesDeps,
): Response | null {
  const readiness = deps.publicShareService.getReadiness();
  if (readiness.state === "ready") return null;
  c.header("Retry-After", "2");
  return c.json(
    {
      error:
        readiness.state === "failed"
          ? "Public share storage is unavailable"
          : `Public share store is ${readiness.state}`,
      retryable:
        readiness.state === "opening" || readiness.state === "migrating",
      storageState: readiness.state,
    },
    503,
  );
}

function contentToPlainText(content: unknown): string {
  if (typeof content === "string") {
    return content;
  }
  if (!Array.isArray(content)) {
    return "";
  }
  return content
    .map((block) => {
      if (!block || typeof block !== "object") {
        return "";
      }
      const value = block as {
        content?: unknown;
        text?: unknown;
        type?: unknown;
      };
      if (value.type === "text" && typeof value.text === "string") {
        return value.text;
      }
      if (typeof value.content === "string") {
        return value.content;
      }
      return "";
    })
    .filter(Boolean)
    .join("\n");
}

function normalizePromptPreview(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  const normalized = trimmed.replace(/\s+/g, " ");
  return normalized.length > PUBLIC_SHARE_INITIAL_PROMPT_MAX_LENGTH
    ? `${normalized
        .slice(0, PUBLIC_SHARE_INITIAL_PROMPT_MAX_LENGTH - 3)
        .trimEnd()}...`
    : normalized;
}

function parseCreatePublicSessionShareRequest(
  value: unknown,
): { request: CreatePublicSessionShareRequest } | { error: string } {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { error: "Request body must be an object" };
  }
  const body = value as Record<string, unknown>;
  if (typeof body.projectId !== "string" || !isUrlProjectId(body.projectId)) {
    return { error: "Invalid project ID format" };
  }
  if (typeof body.sessionId !== "string" || !body.sessionId) {
    return { error: "sessionId is required" };
  }
  if (body.mode !== "frozen" && body.mode !== "live") {
    return { error: "mode must be frozen or live" };
  }
  if (body.title !== undefined && typeof body.title !== "string") {
    return { error: "title must be a string" };
  }
  if (
    body.initialPrompt !== undefined &&
    typeof body.initialPrompt !== "string"
  ) {
    return { error: "initialPrompt must be a string" };
  }
  return {
    request: {
      projectId: body.projectId,
      sessionId: body.sessionId,
      mode: body.mode,
      ...(body.title !== undefined ? { title: body.title } : {}),
      ...(body.initialPrompt !== undefined
        ? { initialPrompt: body.initialPrompt }
        : {}),
    },
  };
}

function getInitialPromptPreview(session: AppSession): string | null {
  for (const message of session.messages) {
    if ((message as { type?: unknown }).type !== "user") {
      continue;
    }
    const content =
      contentToPlainText((message as { content?: unknown }).content) ||
      contentToPlainText(
        (message as { message?: { content?: unknown } }).message?.content,
      );
    const preview = normalizePromptPreview(content);
    if (preview) {
      return preview;
    }
  }
  return null;
}

function notFound(c: Context) {
  return c.json({ error: "Share not found" }, 404);
}

function selectedRepresentationUnavailable(
  c: Context,
  deps: PublicSharePublicRoutesDeps,
  record: NonNullable<ReturnType<PublicShareService["getRecordBySecret"]>>,
  viewerId?: string,
): Response | null {
  if (
    deps.publicShareService.getSelectedRepresentationAvailability(
      record,
      viewerId,
    ) !== "repair-required"
  ) {
    return null;
  }
  return c.json(
    {
      error:
        "This migrated frozen share needs source-session repair before it can be served",
      repairRequired: true,
      retryable: false,
    },
    503,
  );
}

type SharePathFlavor = "posix" | "windows";

function getSharePathFlavor(pathValue: string): SharePathFlavor {
  return /^[A-Za-z]:[\\/]/.test(pathValue) || pathValue.includes("\\")
    ? "windows"
    : "posix";
}

function isAbsoluteSharePath(
  pathValue: string,
  flavor: SharePathFlavor,
): boolean {
  return flavor === "windows"
    ? win32.isAbsolute(pathValue)
    : posix.isAbsolute(pathValue);
}

function normalizeSharePath(
  pathValue: string,
  flavor: SharePathFlavor,
): string {
  return flavor === "windows"
    ? win32.normalize(pathValue)
    : posix.normalize(pathValue.replaceAll("\\", "/"));
}

function resolveSharePath(
  basePath: string,
  pathValue: string,
  flavor: SharePathFlavor,
): string {
  return flavor === "windows"
    ? win32.resolve(basePath, pathValue)
    : posix.resolve(basePath, pathValue.replaceAll("\\", "/"));
}

function relativeSharePath(
  fromPath: string,
  toPath: string,
  flavor: SharePathFlavor,
): string {
  return flavor === "windows"
    ? win32.relative(fromPath, toPath)
    : posix.relative(fromPath, toPath);
}

function isPathInsideDirectory(filePath: string, directory: string): boolean {
  const flavor = getSharePathFlavor(directory);
  const relativePath = relativeSharePath(
    resolveSharePath(directory, "", flavor),
    resolveSharePath(filePath, "", flavor),
    flavor,
  );
  return (
    relativePath === "" ||
    (relativePath !== "" &&
      !relativePath.startsWith("..") &&
      !isAbsoluteSharePath(relativePath, flavor))
  );
}

export function normalizePublicShareProjectFilePath(
  rawPath: string,
  projectRoot: string,
  dataDir?: string,
): string | null {
  const { path: parsedPath } = parseLineColumn(rawPath);
  if (dataDir) {
    const attachmentPath = canonicalizeManagedAttachmentPath(
      parsedPath,
      dataDir,
    );
    if (attachmentPath) {
      return attachmentPath.replaceAll("\\", "/");
    }
  }
  const flavor = getSharePathFlavor(projectRoot);
  const normalizedRoot = resolveSharePath(projectRoot, "", flavor);

  if (isAbsoluteSharePath(parsedPath, flavor)) {
    const absolutePath = resolveSharePath(parsedPath, "", flavor);
    if (!isPathInsideDirectory(absolutePath, normalizedRoot)) {
      return null;
    }
    return relativeSharePath(normalizedRoot, absolutePath, flavor).replaceAll(
      "\\",
      "/",
    );
  }

  const normalized = normalizeSharePath(parsedPath, flavor);
  if (
    !normalized ||
    normalized === "." ||
    normalized.startsWith("..") ||
    isAbsoluteSharePath(normalized, flavor)
  ) {
    return null;
  }
  return normalized.replaceAll("\\", "/");
}

async function loadLivePublicShareResponse(
  deps: PublicSharePublicRoutesDeps,
  record: NonNullable<ReturnType<PublicShareService["getRecordBySecret"]>>,
): Promise<PublicSessionShareResponse | null> {
  const session = await deps.loadSession(
    record.source.projectId,
    record.source.sessionId,
  );
  return session
    ? deps.publicShareService.buildLiveResponse(record, session)
    : null;
}

function collectStringValues(value: unknown): string[] {
  const strings: string[] = [];
  const stack: unknown[] = [value];
  const seen = new WeakSet<object>();

  while (stack.length > 0) {
    const current = stack.pop();
    if (typeof current === "string") {
      strings.push(current);
      continue;
    }
    if (!current || typeof current !== "object" || seen.has(current)) {
      continue;
    }
    seen.add(current);
    if (Array.isArray(current)) {
      stack.push(...current);
      continue;
    }
    stack.push(...Object.values(current));
  }

  return strings;
}

function decodeURIComponentSafe(value: string): string | null {
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}

function hasPublicShareExtension(
  relativePath: string,
  extensions: ReadonlySet<string>,
): boolean {
  return extensions.has(extname(relativePath).toLowerCase());
}

function sanitizePathToken(value: string): string {
  return value
    .trim()
    .replace(/^<|>$/g, "")
    .replace(/[),.;!?]+$/g, "");
}

function normalizeMentionedProjectFilePath(
  rawPath: string,
  projectRoot: string,
  dataDir?: string,
): string | null {
  const sanitized = sanitizePathToken(rawPath);
  return sanitized
    ? normalizePublicShareProjectFilePath(sanitized, projectRoot, dataDir)
    : null;
}

function looksLikeAbsoluteOrHomePath(value: string): boolean {
  const trimmed = value.trim();
  return (
    trimmed.startsWith("~/") ||
    trimmed.startsWith("~\\") ||
    trimmed.startsWith("/") ||
    /^[A-Za-z]:[\\/]/.test(trimmed)
  );
}

function collectPublicShareMentionedProjectFiles(
  session: AppSession,
  projectRoot: string,
  projectId: UrlProjectId,
  dataDir?: string,
): Set<string> {
  const files = new Set<string>();
  const flavor = getSharePathFlavor(projectRoot);
  const normalizedRoot = resolveSharePath(projectRoot, "", flavor).replace(
    /[\\/]+$/,
    "",
  );
  const rootPattern = new RegExp(
    `${escapeRegExp(normalizedRoot)}/[^\\s"'<>)]*\\.[A-Za-z0-9]+(?::\\d+)?`,
    "g",
  );
  const localApiPattern =
    /(?:https?:\/\/[^\s"'<>)]*)?\/api\/local-(?:file|image)\?[^\s"'<>)]*/g;
  const projectFilePattern =
    /(?:https?:\/\/[^\s"'<>)]*)?\/projects\/([^/\s"'<>]+)\/file\?[^\s"'<>)]*/g;
  const relativePathPattern =
    /(?:^|[\s([`'"])([A-Za-z0-9_.@/-]+\.[A-Za-z0-9]{1,16})(?::\d+)?/gi;

  const addPath = (rawPath: string | null) => {
    if (!rawPath) {
      return;
    }
    const normalized = normalizeMentionedProjectFilePath(
      rawPath,
      projectRoot,
      dataDir,
    );
    if (normalized) {
      files.add(normalized);
    }
  };

  for (const value of collectStringValues(session)) {
    const decoded = decodeURIComponentSafe(value);
    const textVariants =
      decoded && decoded !== value ? [value, decoded] : [value];
    for (const text of textVariants) {
      if (looksLikeAbsoluteOrHomePath(text)) {
        addPath(text);
      }
      for (const match of text.matchAll(rootPattern)) {
        addPath(match[0] ?? null);
      }
      for (const match of text
        .replaceAll("&amp;", "&")
        .matchAll(localApiPattern)) {
        try {
          const url = new URL(match[0] ?? "", "http://share.local");
          addPath(url.searchParams.get("path"));
        } catch {
          // Ignore malformed URL-looking substrings.
        }
      }
      for (const match of text
        .replaceAll("&amp;", "&")
        .matchAll(projectFilePattern)) {
        const rawProjectId = match[1];
        const matchedProjectId = rawProjectId
          ? decodeURIComponentSafe(rawProjectId)
          : null;
        if (matchedProjectId !== projectId) {
          continue;
        }
        try {
          const url = new URL(match[0] ?? "", "http://share.local");
          addPath(url.searchParams.get("path"));
        } catch {
          // Ignore malformed URL-looking substrings.
        }
      }
      for (const match of text.matchAll(relativePathPattern)) {
        addPath(match[1] ?? null);
      }
    }
  }

  return files;
}

function extractLocalRenderReferences(content: string): string[] {
  const references = new Set<string>();
  const markdownLinkPattern =
    /!?\[[^\]]*]\(\s*<?([^)\s>]+)>?(?:\s+["'][^"']*["'])?\s*\)/g;
  const htmlReferencePattern = /\b(?:href|src)\s*=\s*["']([^"']+)["']/gi;
  const cssUrlPattern = /\burl\(\s*["']?([^"')]+)["']?\s*\)/gi;

  for (const pattern of [
    markdownLinkPattern,
    htmlReferencePattern,
    cssUrlPattern,
  ]) {
    for (const match of content.matchAll(pattern)) {
      if (match[1]) {
        references.add(match[1]);
      }
    }
  }

  return Array.from(references);
}

function normalizeRenderReferencePath(
  rawReference: string,
  sourceRelativePath: string,
  projectRoot: string,
  projectId: UrlProjectId,
): string | null {
  const reference = sanitizePathToken(rawReference).replaceAll("&amp;", "&");
  if (!reference || reference.startsWith("#")) {
    return null;
  }

  try {
    const url = new URL(reference, "http://share.local");
    if (url.origin !== "http://share.local") {
      return null;
    }
    if (
      url.pathname === "/api/local-file" ||
      url.pathname === "/api/local-image"
    ) {
      return normalizeMentionedProjectFilePath(
        url.searchParams.get("path") ?? "",
        projectRoot,
      );
    }
    const projectFileMatch = /^\/projects\/([^/]+)\/file$/.exec(url.pathname);
    if (projectFileMatch?.[1]) {
      const matchedProjectId = decodeURIComponentSafe(projectFileMatch[1]);
      if (matchedProjectId !== projectId) {
        return null;
      }
      return normalizeMentionedProjectFilePath(
        url.searchParams.get("path") ?? "",
        projectRoot,
      );
    }
    if (/^[a-z][a-z0-9+.-]*:/i.test(reference)) {
      return null;
    }
  } catch {
    if (/^[a-z][a-z0-9+.-]*:/i.test(reference)) {
      return null;
    }
  }

  const pathOnly = reference.split(/[?#]/, 1)[0] ?? "";
  if (!pathOnly) {
    return null;
  }
  if (pathOnly.startsWith("/")) {
    return normalizeMentionedProjectFilePath(pathOnly, projectRoot);
  }

  const flavor = getSharePathFlavor(projectRoot);
  const sourceDir = dirname(
    resolveSharePath(projectRoot, sourceRelativePath, flavor),
  );
  return normalizeMentionedProjectFilePath(
    resolveSharePath(sourceDir, pathOnly, flavor),
    projectRoot,
  );
}

async function readPublicShareRenderSource(
  projectRoot: string,
  relativePath: string,
): Promise<string | null> {
  const opened = await openProjectRelativeFile(projectRoot, relativePath);
  if (!opened) return null;
  try {
    if (opened.stats.size > MAX_PUBLIC_SHARE_TRANSITIVE_SOURCE_BYTES) {
      return null;
    }
    const content = await readFileHandleBounded(
      opened.handle,
      MAX_PUBLIC_SHARE_TRANSITIVE_SOURCE_BYTES,
    );
    return content?.toString("utf8") ?? null;
  } finally {
    await opened.handle.close();
  }
}

async function publicShareSessionMentionsRenderAsset(
  session: AppSession,
  relativePath: string,
  projectRoot: string,
  projectId: UrlProjectId,
  dataDir?: string,
): Promise<boolean> {
  if (
    !hasPublicShareExtension(relativePath, PUBLIC_SHARE_MEDIA_ASSET_EXTENSIONS)
  ) {
    return false;
  }

  const sourcePaths = Array.from(
    collectPublicShareMentionedProjectFiles(
      session,
      projectRoot,
      projectId,
      dataDir,
    ),
  ).filter((sourcePath) =>
    hasPublicShareExtension(sourcePath, PUBLIC_SHARE_RENDER_SOURCE_EXTENSIONS),
  );

  for (const sourcePath of sourcePaths.slice(0, 50)) {
    try {
      const content = await readPublicShareRenderSource(
        projectRoot,
        sourcePath,
      );
      if (content === null) continue;
      for (const reference of extractLocalRenderReferences(content)) {
        if (
          normalizeRenderReferencePath(
            reference,
            sourcePath,
            projectRoot,
            projectId,
          ) === relativePath
        ) {
          return true;
        }
      }
    } catch {}
  }

  return false;
}

/**
 * Everything a live file share's root links to (`walkLinkedSite`), which is
 * exactly what the share authorizes. A target inside the share's project is
 * opened as the share opens project files; one outside it must also pass the
 * local file policy, and without that policy nothing outside is served.
 */
async function linkedFileShareSite(
  deps: PublicSharePublicRoutesDeps,
  fileShare: NonNullable<
    ReturnType<PublicShareService["getFileRecordBySecret"]>
  >,
  projectRoot: string,
): Promise<LinkedSite> {
  const flavor = getSharePathFlavor(projectRoot);
  const root = resolveSharePath(projectRoot, "", flavor);
  return await cachedLinkedSite(
    "public-file-share",
    resolveSharePath(root, fileShare.path, flavor).replaceAll("\\", "/"),
    async (path, document) => {
      if (!isPathInsideDirectory(path, root)) {
        const allowed =
          await deps.localFilePolicy?.resolveAllowedFilePath(path);
        if (!allowed?.ok) return null;
        return document
          ? await readLinkedDocument(
              allowed.file.resolvedPath,
              allowed.file.stats.size,
            )
          : {};
      }
      const opened = await openProjectRelativeFile(
        root,
        relativeSharePath(root, resolveSharePath(path, "", flavor), flavor),
      );
      if (!opened) return null;
      try {
        if (!opened.stats.isFile()) return null;
        if (!document || opened.stats.size > MAX_LINKED_DOCUMENT_BYTES)
          return {};
        const content = await readFileHandleBounded(
          opened.handle,
          MAX_LINKED_DOCUMENT_BYTES,
        );
        return content ? { content: content.toString("utf8") } : {};
      } finally {
        await opened.handle.close();
      }
    },
  );
}

/**
 * The absolute path a file share request names outside the share's project,
 * normalized as its walk names paths; null when it is not absolute.
 */
function outsideProjectSharePath(
  rawPath: string,
  projectRoot: string,
): string | null {
  const { path: parsedPath } = parseLineColumn(rawPath);
  const flavor = getSharePathFlavor(projectRoot);
  return isAbsoluteSharePath(parsedPath, flavor)
    ? resolveSharePath(parsedPath, "", flavor).replaceAll("\\", "/")
    : null;
}

function buildDirectPublicSharePresentation(
  session: AppSession,
  projectRoot: string,
  projectId: UrlProjectId,
  dataDir?: string,
): { version: 1; authorizedPaths: string[] } {
  return {
    version: 1,
    authorizedPaths: [
      ...collectPublicShareMentionedProjectFiles(
        session,
        projectRoot,
        projectId,
        dataDir,
      ),
    ].sort(),
  };
}

async function extendPublicSharePresentationFromProjectRoot(
  directPresentation: { version: 1; authorizedPaths: string[] },
  projectRoot: string,
  projectId: UrlProjectId,
): Promise<{ version: 1; authorizedPaths: string[] }> {
  const authorizedPaths = new Set(directPresentation.authorizedPaths);
  const sourcePaths = [...authorizedPaths].filter((sourcePath) =>
    hasPublicShareExtension(sourcePath, PUBLIC_SHARE_RENDER_SOURCE_EXTENSIONS),
  );
  for (const sourcePath of sourcePaths.slice(0, 50)) {
    try {
      const content = await readPublicShareRenderSource(
        projectRoot,
        sourcePath,
      );
      if (content === null) continue;
      for (const reference of extractLocalRenderReferences(content)) {
        const normalized = normalizeRenderReferencePath(
          reference,
          sourcePath,
          projectRoot,
          projectId,
        );
        if (normalized) authorizedPaths.add(normalized);
      }
    } catch {
      // A disappearing captured render source contributes no transitive grant.
    }
  }
  return {
    version: 1,
    authorizedPaths: [...authorizedPaths].sort(),
  };
}

export async function buildPublicSharePresentation(
  session: AppSession,
  projectRoot: string,
  projectId: UrlProjectId,
  dataDir?: string,
): Promise<{ version: 1; authorizedPaths: string[] }> {
  return await extendPublicSharePresentationFromProjectRoot(
    buildDirectPublicSharePresentation(
      session,
      projectRoot,
      projectId,
      dataDir,
    ),
    projectRoot,
    projectId,
  );
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function publicShareFileRawUrl(
  secret: string,
  relativePath: string,
  viewerId?: string,
): string {
  const params = new URLSearchParams({ path: relativePath });
  if (viewerId) params.set("viewerId", viewerId);
  return `/public-api/shares/${encodeURIComponent(secret)}/files/raw?${params}`;
}

async function servePublicShareProjectFile(
  c: Context,
  deps: PublicSharePublicRoutesDeps,
  options: { raw: boolean },
): Promise<Response> {
  if (!(deps.getPublicSharesEnabled?.() ?? false)) {
    return notFound(c);
  }
  const unavailable = publicShareStoreUnavailable(c, deps);
  if (unavailable) return unavailable;
  if (!deps.fetchProjectFile) {
    return notFound(c);
  }

  const secret = c.req.param("secret");
  if (!secret) {
    return notFound(c);
  }
  const record = deps.publicShareService.getRecordBySecret(secret);
  const fileShare = record
    ? null
    : deps.publicShareService.getFileRecordBySecret(secret);
  if (!record && !fileShare) {
    return notFound(c);
  }
  const viewerId = c.req.query("viewerId");
  if (record) {
    const representationUnavailable = selectedRepresentationUnavailable(
      c,
      deps,
      record,
      viewerId,
    );
    if (representationUnavailable) return representationUnavailable;
    if (
      viewerId &&
      deps.publicShareService.isViewerDisconnected(record, viewerId)
    ) {
      return notFound(c);
    }
  }

  const projectId = record?.source.projectId ?? fileShare!.projectId;
  let projectRoot: string;
  try {
    projectRoot = decodeProjectId(projectId);
  } catch {
    return notFound(c);
  }

  const rawPath = c.req.query("path");
  if (!rawPath) {
    return c.json({ error: "Missing path parameter" }, 400);
  }
  const relativePath = normalizePublicShareProjectFilePath(
    rawPath,
    projectRoot,
    record ? deps.dataDir : undefined,
  );
  // A live file share also serves what its root links to outside its
  // project, named by absolute path.
  const outsidePath =
    !relativePath && fileShare
      ? outsideProjectSharePath(rawPath, projectRoot)
      : null;
  const sharePath = relativePath ?? outsidePath;
  if (!sharePath) {
    return c.json({ error: "Invalid file path" }, 400);
  }

  let authorized: boolean;
  if (fileShare) {
    const flavor = getSharePathFlavor(projectRoot);
    const target =
      outsidePath ??
      resolveSharePath(projectRoot, sharePath, flavor).replaceAll("\\", "/");
    authorized =
      (await linkedFileShareSite(deps, fileShare, projectRoot)).files.some(
        (file) => file.path === target,
      ) &&
      // A reused walk predates any policy change; the read must not.
      (!outsidePath ||
        (await deps.localFilePolicy?.resolveAllowedFilePath(outsidePath))
          ?.ok === true);
  } else if (!relativePath) {
    return notFound(c);
  } else {
    if (!record) return notFound(c);
    const sessionRecord = record;
    authorized = false;
    const viewerHasSnapshot = Boolean(
      viewerId &&
        deps.publicShareService.hasViewerSnapshot(sessionRecord, viewerId),
    );
    if (sessionRecord.mode === "frozen" || viewerHasSnapshot) {
      const presentation = await deps.publicShareService.getFrozenPresentation(
        sessionRecord,
        viewerId,
      );
      authorized =
        presentation?.authorizedPaths.includes(relativePath) ?? false;
    } else {
      const shareResponse = await loadLivePublicShareResponse(
        deps,
        sessionRecord,
      );
      if (shareResponse) {
        const directPresentation = buildDirectPublicSharePresentation(
          shareResponse.session,
          projectRoot,
          sessionRecord.source.projectId,
          deps.dataDir,
        );
        authorized =
          directPresentation.authorizedPaths.includes(relativePath) ||
          (await publicShareSessionMentionsRenderAsset(
            shareResponse.session,
            relativePath,
            projectRoot,
            sessionRecord.source.projectId,
            deps.dataDir,
          ));
      }
    }
  }
  if (!authorized) {
    return notFound(c);
  }

  const lineNumber = parsePositiveIntegerQuery(c.req.query("line"));
  const lineEnd = parsePositiveIntegerQuery(c.req.query("lineEnd"));
  const fileOptions: Parameters<
    NonNullable<PublicShareRoutesDeps["fetchProjectFile"]>
  >[2] = {
    download: c.req.query("download") === "true",
    highlight: c.req.query("highlight") === "true",
    raw: options.raw,
  };
  if (lineNumber !== undefined) {
    fileOptions.lineNumber = lineNumber;
  }
  if (lineEnd !== undefined) {
    fileOptions.lineEnd = lineEnd;
  }
  if (c.req.query("view") === "range") {
    fileOptions.viewMode = "range";
  }

  const attachmentPath =
    deps.dataDir && relativePath
      ? canonicalizeManagedAttachmentPath(relativePath, deps.dataDir)
      : null;
  const frozenProjectRoot =
    !record || attachmentPath
      ? undefined
      : await deps.publicShareService.getFrozenProjectRoot(record, viewerId);
  // An outside target is read as the one file of its own folder.
  const readRoot = outsidePath ? dirname(outsidePath) : frozenProjectRoot;
  const response = await deps.fetchProjectFile(
    projectId,
    outsidePath ? basename(outsidePath) : sharePath,
    {
      ...fileOptions,
      ...(readRoot ? { projectRoot: readRoot } : {}),
    },
  );

  if (options.raw) {
    const headers = createUntrustedFileResponseHeaders({
      baseHeaders: response.headers,
      filePath: sharePath,
    });
    headers.set("Cache-Control", "no-store");
    return new Response(response.body, {
      headers,
      status: response.status,
      statusText: response.statusText,
    });
  }

  if (!response.ok) {
    return response;
  }

  const body = (await response.json()) as FileContentResponse;
  body.rawUrl = publicShareFileRawUrl(secret, sharePath, viewerId);
  if (outsidePath && body.renderedMarkdownHtml) {
    body.renderedMarkdownHtml = restateStandInProjectLinks(
      body.renderedMarkdownHtml,
      dirname(outsidePath),
    );
  }
  c.header("Cache-Control", "no-store");
  return c.json(body);
}

/**
 * An outside target is read with its own folder standing in as the project,
 * so the project-file links rendered in it name paths relative to that
 * folder, under the share's project id. Restate each as the local-file link
 * the renderer gives a file outside any project, by absolute path, which a
 * live file share's viewer resolves against its own grant. Private inline-code
 * links stay as they are; the viewer shows those as plain code.
 */
function restateStandInProjectLinks(html: string, folder: string): string {
  return html.replace(
    /<a [^>]*data-ya-resource="project-file"[^>]*>/g,
    (tag) => {
      if (tag.includes('data-ya-private-project-file-link="true"')) return tag;
      const attribute = (name: string) => {
        const value = new RegExp(`\\s${name}="([^"]*)"`).exec(tag)?.[1];
        return value === undefined ? undefined : unescapeHtmlAttribute(value);
      };
      const relativePath = attribute("data-ya-path");
      if (!relativePath) return tag;
      const lineNumber = Number(attribute("data-ya-line")) || undefined;
      const columnNumber = Number(attribute("data-ya-column")) || undefined;
      return renderLocalFileLinkOpen(
        {
          filePath: posix.join(folder, relativePath),
          ...(lineNumber ? { lineNumber } : {}),
          ...(columnNumber ? { columnNumber } : {}),
        },
        { renderMarkdown: /\.(?:md|markdown|qmd)$/i.test(relativePath) },
      );
    },
  );
}

function unescapeHtmlAttribute(value: string): string {
  return value
    .replaceAll("&quot;", '"')
    .replaceAll("&#039;", "'")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&amp;", "&");
}

function streamMaterializedPublicShareResponse(
  response: PublicSessionShareResponse,
): Response {
  return new Response(
    legacyPublicShareResponseStream(
      serializeLegacyPublicShareResponse(
        response.share,
        serializeLegacyJsonValue(response.session),
      ),
    ),
    {
      headers: {
        "Cache-Control": "no-store",
        "Content-Type": "application/json; charset=UTF-8",
      },
    },
  );
}

async function streamFrozenPublicShareResponse(
  deps: PublicSharePublicRoutesDeps,
  record: NonNullable<ReturnType<PublicShareService["getRecordBySecret"]>>,
  options: { rawWire: boolean; viewerId?: string },
): Promise<Response | null> {
  const frozen = await deps.publicShareService.getFrozenSessionJsonChunks(
    record,
    options.viewerId,
  );
  if (!frozen) return null;
  const share = {
    mode: "frozen" as const,
    title: record.title,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    capturedAt: frozen.capturedAt,
    linkedFileMode: frozen.linkedFileMode,
    activeViewerCount: deps.publicShareService.getActiveViewerCount(record),
    source: record.source,
  };
  const body = legacyPublicShareResponseStream(
    serializeLegacyPublicShareResponse(share, frozen.chunks),
  );
  return new Response(body, {
    headers: {
      "Cache-Control": "no-store",
      "Content-Type": options.rawWire
        ? "application/x-yep-public-share+json; charset=utf-8"
        : "application/json; charset=UTF-8",
    },
  });
}

function getSessionParams(
  c: Context,
): { projectId: UrlProjectId; sessionId: string } | { error: Response } {
  const projectId = c.req.param("projectId");
  const sessionId = c.req.param("sessionId");
  if (typeof projectId !== "string" || !isUrlProjectId(projectId)) {
    return { error: c.json({ error: "Invalid project ID format" }, 400) };
  }
  if (!sessionId || typeof sessionId !== "string") {
    return { error: c.json({ error: "sessionId is required" }, 400) };
  }
  return { projectId, sessionId };
}

export async function captureCompletePublicShare(
  deps: Pick<
    PublicShareRoutesDeps,
    "loadCompleteSession" | "publicShareService" | "dataDir"
  >,
  projectId: UrlProjectId,
  sessionId: string,
): Promise<PublicShareCapture | null> {
  const capture = await deps.publicShareService.captureCompleteSession(
    async () => {
      const session = await deps.loadCompleteSession(projectId, sessionId);
      if (session) {
        await augmentPublicShareMessages(
          session.messages as Message[],
          projectId,
        );
      }
      return session;
    },
  );
  if (!capture) return null;

  const projectRoot = decodeProjectId(projectId);
  const presentation = buildDirectPublicSharePresentation(
    capture.snapshot,
    projectRoot,
    projectId,
    deps.dataDir,
  );
  return {
    ...capture,
    projectRoot,
    presentation,
    derivePresentationFromProjectRoot: (capturedProjectRoot: string) =>
      extendPublicSharePresentationFromProjectRoot(
        presentation,
        capturedProjectRoot,
        projectId,
      ),
  };
}

function publicShareCaptureErrorResponse(
  c: Context,
  error: unknown,
): Response | never {
  if (error instanceof PublicShareCaptureError) {
    return c.json({ error: error.message, retryable: true }, 409);
  }
  throw error;
}

export function createPublicShareRoutes(deps: PublicShareRoutesDeps): Hono {
  const app = new Hono();

  app.get("/status", (c) => {
    const readiness = getPublicShareReadiness(deps);
    const storage = deps.publicShareService.getReadiness();
    let yaClientBaseUrl: string | null = null;
    let viewerBaseUrl: string | null = null;
    let yaClientBaseUrlError: string | undefined;
    try {
      yaClientBaseUrl = resolveYaClientBaseUrl(
        deps.getYaClientBaseUrl?.(),
        deps.getPublicShareViewerBaseUrl?.(),
      );
      viewerBaseUrl = resolvePublicShareViewerBaseUrl(yaClientBaseUrl);
    } catch (error) {
      yaClientBaseUrlError =
        error instanceof Error ? error.message : "Invalid YA URL";
    }
    return c.json({
      enabled: readiness.enabled,
      configured: readiness.configured,
      requiresRelay: true,
      remoteAccessEnabled: readiness.remoteAccessEnabled,
      relayStatus: readiness.relayStatus,
      relayUrl: readiness.relayConfig?.url ?? null,
      relayUsername: readiness.relayConfig?.username ?? null,
      canCreate: readiness.canCreate,
      storageState: readiness.enabled ? storage.state : "disabled",
      storageError: storage.error,
      totalValidLinks:
        storage.state === "ready"
          ? deps.publicShareService.getValidShareCount()
          : null,
      yaClientBaseUrl,
      defaultYaClientBaseUrl: getDefaultYaClientBaseUrl(),
      viewerBaseUrl,
      defaultViewerBaseUrl: getDefaultPublicShareViewerBaseUrl(),
      ...(yaClientBaseUrlError
        ? {
            yaClientBaseUrlError,
            viewerBaseUrlError: yaClientBaseUrlError,
          }
        : {}),
    });
  });

  app.get("/sessions/:projectId/:sessionId", async (c) => {
    const unavailable = publicShareStoreUnavailable(c, deps);
    if (unavailable) return unavailable;
    const params = getSessionParams(c);
    if ("error" in params) return params.error;
    const sessionUpdatedAt = deps.loadSessionUpdatedAt
      ? await deps.loadSessionUpdatedAt(params.projectId, params.sessionId)
      : (await deps.loadSession(params.projectId, params.sessionId))?.updatedAt;
    const response: PublicSessionShareSessionStatusResponse =
      deps.publicShareService.getSessionShareStatus(
        params.projectId,
        params.sessionId,
        { sessionUpdatedAt },
      );
    return c.json(response);
  });

  app.delete("/sessions/:projectId/:sessionId", async (c) => {
    const unavailable = publicShareStoreUnavailable(c, deps);
    if (unavailable) return unavailable;
    const params = getSessionParams(c);
    if ("error" in params) return params.error;
    const response: RevokePublicSessionSharesResponse =
      await deps.publicShareService.revokeSessionShares(
        params.projectId,
        params.sessionId,
      );
    return c.json(response);
  });

  app.post("/sessions/:projectId/:sessionId/freeze-live", async (c) => {
    const unavailable = publicShareStoreUnavailable(c, deps);
    if (unavailable) return unavailable;
    const params = getSessionParams(c);
    if ("error" in params) return params.error;
    try {
      const capture = await captureCompletePublicShare(
        deps,
        params.projectId,
        params.sessionId,
      );
      if (!capture) {
        return c.json({ error: "Session not found" }, 404);
      }
      const response: FreezePublicSessionLiveSharesResponse =
        await deps.publicShareService.freezeSessionLiveShares(
          params.projectId,
          params.sessionId,
          capture,
        );
      return c.json(response);
    } catch (error) {
      return publicShareCaptureErrorResponse(c, error);
    }
  });

  app.post(
    "/sessions/:projectId/:sessionId/viewers/:viewerId/freeze",
    async (c) => {
      const unavailable = publicShareStoreUnavailable(c, deps);
      if (unavailable) return unavailable;
      const params = getSessionParams(c);
      if ("error" in params) return params.error;
      const viewerId = c.req.param("viewerId");
      if (
        !deps.publicShareService.canFreezeSessionViewerToken(
          params.projectId,
          params.sessionId,
          viewerId,
        )
      ) {
        return c.json(
          deps.publicShareService.getSessionViewerFreezeStatus(
            params.projectId,
            params.sessionId,
            viewerId,
          ),
        );
      }
      try {
        const capture = await captureCompletePublicShare(
          deps,
          params.projectId,
          params.sessionId,
        );
        if (!capture) {
          return c.json({ error: "Session not found" }, 404);
        }
        const response: PublicSessionShareViewerActionResponse =
          await deps.publicShareService.freezeSessionViewerToken(
            params.projectId,
            params.sessionId,
            viewerId,
            capture,
          );
        return c.json(response);
      } catch (error) {
        return publicShareCaptureErrorResponse(c, error);
      }
    },
  );

  app.delete("/sessions/:projectId/:sessionId/viewers/:viewerId", async (c) => {
    const unavailable = publicShareStoreUnavailable(c, deps);
    if (unavailable) return unavailable;
    const params = getSessionParams(c);
    if ("error" in params) return params.error;
    const viewerId = c.req.param("viewerId");
    const response: PublicSessionShareViewerActionResponse =
      await deps.publicShareService.disconnectSessionViewerToken(
        params.projectId,
        params.sessionId,
        viewerId,
      );
    return c.json(response);
  });

  app.post("/", async (c) => {
    const unavailable = publicShareStoreUnavailable(c, deps);
    if (unavailable) return unavailable;
    let rawBody: unknown;
    try {
      rawBody = await c.req.json<unknown>();
    } catch {
      return c.json({ error: "Invalid JSON body" }, 400);
    }
    const parsedBody = parseCreatePublicSessionShareRequest(rawBody);
    if ("error" in parsedBody) {
      return c.json({ error: parsedBody.error }, 400);
    }
    const body = parsedBody.request;
    const readiness = getPublicShareReadiness(deps);
    if (!readiness.enabled) {
      return c.json(
        {
          error:
            "Public Read-Only Share must be enabled in Advanced settings before creating links",
        },
        403,
      );
    }

    const relayConfig = readiness.relayConfig;
    if (!relayConfig?.url || !relayConfig.username) {
      return c.json(
        {
          error:
            "Remote relay must be configured before creating public share links",
        },
        400,
      );
    }
    if (!readiness.remoteAccessEnabled) {
      return c.json(
        {
          error:
            "Remote Access must be enabled before creating public share links",
        },
        400,
      );
    }

    let yaClientBaseUrl: string;
    try {
      yaClientBaseUrl = resolveYaClientBaseUrl(
        deps.getYaClientBaseUrl?.(),
        deps.getPublicShareViewerBaseUrl?.(),
      );
    } catch (error) {
      return c.json(
        {
          error: error instanceof Error ? error.message : "Invalid YA URL",
        },
        400,
      );
    }

    let capture: PublicShareCapture | null = null;
    let sessionSummary: Pick<
      AppSession,
      | "customTitle"
      | "fullTitle"
      | "initialPrompt"
      | "provider"
      | "title"
      | "updatedAt"
    > | null = null;
    if (body.mode === "frozen") {
      try {
        capture = await captureCompletePublicShare(
          deps,
          body.projectId,
          body.sessionId,
        );
      } catch (error) {
        return publicShareCaptureErrorResponse(c, error);
      }
      sessionSummary = capture?.snapshot ?? null;
    } else if (deps.loadSessionSummary) {
      sessionSummary = await deps.loadSessionSummary(
        body.projectId,
        body.sessionId,
      );
    } else {
      sessionSummary = await deps.loadSession(body.projectId, body.sessionId);
    }
    if (!sessionSummary) {
      return c.json({ error: "Session not found" }, 404);
    }

    const title =
      body.title ?? sessionSummary.customTitle ?? sessionSummary.title;
    const projectRoot = decodeProjectId(body.projectId);
    const projectName = (deps.projectDisplayName ?? getProjectName)(
      projectRoot,
    );
    const initialPrompt =
      normalizePromptPreview(sessionSummary.initialPrompt ?? "") ??
      (capture ? getInitialPromptPreview(capture.snapshot) : null) ??
      normalizePromptPreview(sessionSummary.fullTitle ?? "") ??
      normalizePromptPreview(body.initialPrompt ?? "");
    const secretUrl = (secret: string) =>
      buildPublicShareUrl(secret, relayConfig, yaClientBaseUrl);
    let created: Awaited<ReturnType<PublicShareService["createShare"]>>;
    try {
      created = await deps.publicShareService.createShare({
        mode: body.mode,
        title,
        initialPrompt,
        source: {
          projectId: body.projectId,
          sessionId: body.sessionId,
          projectName,
          provider: sessionSummary.provider,
        },
        buildPublicUrl: secretUrl,
        ...(capture ? { capture } : {}),
      });
    } catch (error) {
      return publicShareCaptureErrorResponse(c, error);
    }
    const { secret, secretBits, record } = created;

    const response: CreatePublicSessionShareResponse = {
      url: record.publicUrl ?? secretUrl(secret),
      shareId: record.shareId,
      mode: record.mode,
      createdAt: record.createdAt,
      secretBits,
      linkedFileMode: record.linkedFileMode,
    };
    return c.json(response);
  });

  return app;
}

export function createPublicSharePublicRoutes(
  deps: PublicSharePublicRoutesDeps,
): Hono {
  const app = new Hono();

  app.get("/:secret/metadata", async (c) => {
    if (!(deps.getPublicSharesEnabled?.() ?? false)) return notFound(c);
    const unavailable = publicShareStoreUnavailable(c, deps);
    if (unavailable) return unavailable;
    const record = deps.publicShareService.getRecordBySecret(
      c.req.param("secret"),
    );
    if (!record) return notFound(c);
    const viewerId = c.req.query("viewerId");
    if (
      viewerId &&
      deps.publicShareService.isViewerDisconnected(record, viewerId)
    ) {
      return notFound(c);
    }

    const metadata = deps.publicShareService.getPublicMetadata(
      record,
      viewerId,
    );
    if (
      deps.publicShareService.getSelectedRepresentationAvailability(
        record,
        viewerId,
      ) === "available"
    ) {
      const sessionChunks =
        await deps.publicShareService.getFrozenSessionChunksMetadata(
          record,
          viewerId,
        );
      if (sessionChunks) {
        metadata.capabilities = [PUBLIC_SHARE_SESSION_CHUNKS_CAPABILITY];
        metadata.sessionChunks = sessionChunks;
      }
    }
    c.header("Cache-Control", "no-store");
    return c.json(metadata);
  });

  app.get("/:secret/session-chunks", async (c) => {
    if (!(deps.getPublicSharesEnabled?.() ?? false)) return notFound(c);
    const unavailable = publicShareStoreUnavailable(c, deps);
    if (unavailable) return unavailable;
    const record = deps.publicShareService.getRecordBySecret(
      c.req.param("secret"),
    );
    if (!record) return notFound(c);
    const viewerId = c.req.query("viewerId");
    const representationUnavailable = selectedRepresentationUnavailable(
      c,
      deps,
      record,
      viewerId,
    );
    if (representationUnavailable) return representationUnavailable;
    if (
      viewerId &&
      deps.publicShareService.isViewerDisconnected(record, viewerId)
    ) {
      return notFound(c);
    }

    let chunk: Awaited<ReturnType<PublicShareService["getFrozenSessionChunk"]>>;
    try {
      chunk = await deps.publicShareService.getFrozenSessionChunk(
        record,
        viewerId,
        c.req.query("cursor"),
      );
    } catch (error) {
      if (error instanceof PublicShareChunkCursorError) {
        return c.json(
          {
            error: error.message,
            retryable: false,
          },
          409,
        );
      }
      throw error;
    }
    if (!chunk) {
      return c.json(
        {
          error:
            "Bounded frozen share transfer is unavailable for this revision; update or recreate the public share",
          retryable: false,
          updateRequired: true,
        },
        409,
      );
    }
    if (!c.req.query("cursor") && viewerId) {
      deps.publicShareService.recordViewerHeartbeat(record, viewerId);
    }

    const headers = new Headers({
      "Cache-Control": "no-store",
      "Content-Type": "application/octet-stream",
      "X-Yep-Public-Share-Chunk-Index": String(chunk.index),
      "X-Yep-Public-Share-Chunk-Offset": String(chunk.offset),
      "X-Yep-Public-Share-Compressed-Bytes": String(
        chunk.metadata.compressedBytes,
      ),
      "X-Yep-Public-Share-Final": chunk.final ? "true" : "false",
      "X-Yep-Public-Share-Integrity": chunk.metadata.integrityWitness,
      "X-Yep-Public-Share-Next-Offset": String(chunk.nextOffset),
      "X-Yep-Public-Share-Revision": chunk.metadata.revisionId,
    });
    if (chunk.cursor) {
      headers.set("X-Yep-Public-Share-Next-Cursor", chunk.cursor);
    }
    return new Response(Uint8Array.from(chunk.bytes).buffer, { headers });
  });

  app.get("/:secret/files/raw", (c) =>
    servePublicShareProjectFile(c, deps, { raw: true }),
  );

  app.get("/:secret/files", (c) =>
    servePublicShareProjectFile(c, deps, { raw: false }),
  );

  app.get("/:secret", async (c) => {
    if (!(deps.getPublicSharesEnabled?.() ?? false)) {
      return notFound(c);
    }
    const unavailable = publicShareStoreUnavailable(c, deps);
    if (unavailable) return unavailable;
    const secret = c.req.param("secret");
    const viewerId = c.req.query("viewerId");
    const afterMessageId = c.req.query("afterMessageId");
    const record = deps.publicShareService.getRecordBySecret(secret);
    if (!record) {
      return notFound(c);
    }
    const representationUnavailable = selectedRepresentationUnavailable(
      c,
      deps,
      record,
      viewerId,
    );
    if (representationUnavailable) return representationUnavailable;
    if (
      viewerId &&
      deps.publicShareService.isViewerDisconnected(record, viewerId)
    ) {
      return notFound(c);
    }

    if (
      record.mode === "frozen" ||
      (viewerId && deps.publicShareService.hasViewerSnapshot(record, viewerId))
    ) {
      const response = await streamFrozenPublicShareResponse(deps, record, {
        rawWire: c.req.query("wire") === "raw-json",
        ...(viewerId ? { viewerId } : {}),
      });
      if (!response) return notFound(c);
      if (viewerId) {
        deps.publicShareService.recordViewerHeartbeat(record, viewerId);
      }
      return response;
    }

    let response: PublicSessionShareResponse | null;
    if (viewerId) {
      response = await deps.publicShareService.getViewerSnapshotResponse(
        record,
        viewerId,
      );
    } else {
      response = null;
    }

    if (!response) {
      const session = await deps.loadSession(
        record.source.projectId,
        record.source.sessionId,
        { afterMessageId },
      );
      response = session
        ? deps.publicShareService.buildLiveResponse(record, session)
        : null;
    }

    if (!response) {
      return notFound(c);
    }

    await augmentPublicShareMessages(
      response.session.messages as Message[],
      record.source.projectId,
    );
    response.share.activeViewerCount = viewerId
      ? deps.publicShareService.recordViewerHeartbeat(record, viewerId)
      : deps.publicShareService.getActiveViewerCount(record);

    return streamMaterializedPublicShareResponse(response);
  });

  return app;
}
