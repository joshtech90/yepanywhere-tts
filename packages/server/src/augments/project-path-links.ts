import {
  findProjectPathTokens,
  type ProjectPathLinkTarget,
  type ProjectPathToken,
  splitTrailingCitedPosition,
} from "@yep-anywhere/shared";
import {
  dirname,
  isAbsolute,
  join,
  normalize,
  relative,
  resolve,
  sep,
} from "node:path";
import { homedir } from "node:os";
import type { ProjectPathIndex } from "../projects/projectPathIndex.js";
import {
  escapeHtml,
  renderLocalFileLink,
  renderProjectFileViewerLink,
} from "./safe-markdown.js";

/**
 * Turn bare project-relative paths inside highlighted file content into the
 * same local-file links the Markdown viewer produces.
 *
 * Membership in the project's path set is the entire test — a string links
 * because it *is* a file here, not because it looks like one. That is what
 * makes this safe to run over arbitrary content: a JSON value like
 * `"runs/eval-v2.jsonl"` links, and prose about `application/json` or a
 * version like `1.2.3` cannot, without either needing a rule of its own.
 */

/**
 * Characters a path token may contain. Deliberately excludes quotes, brackets,
 * commas and colons so a JSON string, a YAML value, or a bare word in prose
 * yields the path and nothing around it. `&` is excluded because the
 * surrounding HTML is escaped and a decoded entity would not round-trip.
 */
const PATH_TOKEN = /[^\s"'`<>&,:;()[\]{}=|]+/g;

/** Trailing punctuation a writer adds that is not part of the path. */
const TRAILING_NOISE = /[.!?]+$/;

/** Longest trailing run still read as an extension: `.jsonl`, not a hash. */
const MAX_EXTENSION_LENGTH = 8;
const MIN_ABSOLUTE_PATH_LENGTH = 4;
const MAX_ABSOLUTE_PATH_PROBES = 64;
const VIEWED_FILE_ROOT_PREFIX = /^\$ROOT[\\/](.+)$/;

function mayCostAbsoluteLookup(token: string): boolean {
  return (
    token.length >= MIN_ABSOLUTE_PATH_LENGTH &&
    ((token.startsWith("/") && !token.startsWith("//")) ||
      token.startsWith("~/") ||
      /^[A-Za-z]:[\\/]/.test(token))
  );
}

/** The file an absolute token names: `~/` is this server's home, not the browser's. */
function absoluteTokenTarget(token: string): string {
  return token.startsWith("~/") ? join(homedir(), token.slice(2)) : token;
}

interface AbsoluteFileTarget {
  filePath: string;
  lineNumber?: number;
  columnNumber?: number;
}

/**
 * Files an absolute token may name, in preference order.
 *
 * The whole token comes first, so a file really named `notes.md:12` still
 * wins. Only when it is not a file does a trailing line suffix count as a
 * citation of the path before it; the token is never cut anywhere else.
 */
function absoluteTokenTargets(token: string): AbsoluteFileTarget[] {
  const targets: AbsoluteFileTarget[] = [
    { filePath: absoluteTokenTarget(token) },
  ];
  const cited = splitTrailingCitedPosition(token);
  if (cited && mayCostAbsoluteLookup(cited.path)) {
    const { lineNumber, columnNumber } = cited.position;
    targets.push({
      filePath: absoluteTokenTarget(cited.path),
      lineNumber,
      ...(columnNumber !== undefined ? { columnNumber } : {}),
    });
  }
  return targets;
}

function decodeHtmlText(text: string): string {
  return text.replace(
    /&(amp|lt|gt|quot|apos|#39|#\d+|#x[\da-f]+);/gi,
    (entity, name: string) => {
      switch (name.toLowerCase()) {
        case "amp":
          return "&";
        case "lt":
          return "<";
        case "gt":
          return ">";
        case "quot":
          return '"';
        case "apos":
        case "#39":
          return "'";
        default: {
          const radix = name[1]?.toLowerCase() === "x" ? 16 : 10;
          const digits = name.slice(radix === 16 ? 2 : 1);
          const codePoint = Number.parseInt(digits, radix);
          return Number.isFinite(codePoint) && codePoint <= 0x10ffff
            ? String.fromCodePoint(codePoint)
            : entity;
        }
      }
    },
  );
}

/**
 * Whether a token may cost a filesystem call.
 *
 * A separator, a leading dot, or a trailing extension is what distinguishes a
 * path from an ordinary word. The extension must contain a letter, so a version
 * like `1.2.3` stays a word.
 *
 * This gates *I/O*, not linking. A token failing it is still linked when the
 * cache already proves it, so a bare `Makefile` in a directory that has been
 * listed links for free and only an unlisted one goes unlinked.
 */
function mayCostLookup(token: string): boolean {
  // Only project-relative paths are ever linked, so a leading separator rules
  // the token out outright — which is also what a URL's `//host/path` becomes
  // once the tokenizer drops the scheme at its colon. `~/` is home-relative.
  if (token.startsWith("/") || token.startsWith("~/")) return false;
  if (token.includes("/") || token.includes("\\") || token.startsWith(".")) {
    return true;
  }
  const dot = token.lastIndexOf(".");
  if (dot <= 0 || dot === token.length - 1) return false;
  const extension = token.slice(dot + 1);
  return (
    extension.length <= MAX_EXTENSION_LENGTH &&
    /^[A-Za-z0-9]+$/.test(extension) &&
    /[A-Za-z]/.test(extension)
  );
}

/** Whether this markup opens or closes an element, and which. */
function tagName(tag: string): { closing: boolean; name: string } | null {
  const match = /^<(\/?)([A-Za-z][A-Za-z0-9]*)/.exec(tag);
  if (!match) return null;
  return { closing: match[1] === "/", name: match[2]!.toLowerCase() };
}

export interface ProjectPathLinkOptions {
  /** Project whose authenticated FileViewer route owns generated links. */
  projectId?: string;
  /** Absolute path of the project the content belongs to. */
  projectPath: string;
  index: ProjectPathIndex;
  /** Use only watcher-backed facts already in memory, without starting I/O. */
  pathDiscovery?: "known-only" | "resolve";
  /** Project-relative viewed-file path; owns sibling resolution and self-suppression. */
  selfRelativePath?: string;
  /** Resolved viewed-file path; enables bounded sibling probes outside the project. */
  selfAbsolutePath?: string;
  /**
   * Spend filesystem I/O only on path-shaped tokens.
   *
   * Set for prose, where most words are words. The file viewer leaves it off:
   * every token there came out of a file the reader is already looking at, and
   * one batch groups them by directory anyway.
   */
  gateLookupsByShape?: boolean;
  /** Add occurrence-specific directory context to authenticated turn prose. */
  mentionedDirectories?: boolean;
  /** Marks direct filesystem answers that no live watcher versions. */
  onUnversionedLookup?: () => void;
  /** Positive allow-set facts already resolved by an earlier background pass. */
  knownAbsoluteFilePaths?: (paths: readonly string[]) => ReadonlySet<string>;
  /** Authenticated, allow-set-aware exact probes. Omit for public shares. */
  resolveAbsoluteFilePaths?: (
    paths: readonly string[],
  ) => Promise<ReadonlySet<string>>;
}

interface ResolvedProjectPathCandidates {
  /** Visible absolute or `~/` token → the existing file it names. */
  absolute: ReadonlyMap<string, AbsoluteFileTarget>;
  externalRelative: ReadonlyMap<string, string>;
  relative: ReadonlyMap<string, string>;
}

function externalViewedFileDirectory({
  projectPath,
  selfAbsolutePath,
}: ProjectPathLinkOptions): { directory: string; self: string } | null {
  if (!selfAbsolutePath || !isAbsolute(selfAbsolutePath)) return null;
  const projectRoot = resolve(projectPath);
  const self = resolve(selfAbsolutePath);
  const projectRelative = relative(projectRoot, self);
  if (
    projectRelative === "" ||
    (projectRelative !== ".." &&
      !projectRelative.startsWith(`..${sep}`) &&
      !isAbsolute(projectRelative))
  ) {
    return null;
  }
  return { directory: dirname(self), self };
}

function externalRelativeCandidateTargets(
  candidates: readonly string[],
  options: ProjectPathLinkOptions,
  limit: number,
): ReadonlyMap<string, string> {
  const viewedFile = externalViewedFileDirectory(options);
  if (!viewedFile || limit <= 0) return new Map();

  const distinct = Array.from(new Set(candidates));
  const eligible =
    distinct.length <= limit
      ? distinct
      : distinct.filter(mayCostLookup).slice(0, limit);
  const targets = new Map<string, string>();
  for (const candidate of eligible) {
    const target = resolve(viewedFile.directory, candidate);
    if (target !== viewedFile.self) targets.set(candidate, target);
  }
  return targets;
}

function viewedFileDirectory(selfRelativePath: string | undefined): {
  directory: string;
  self: string;
} | null {
  if (
    !selfRelativePath ||
    isAbsolute(selfRelativePath) ||
    /^[A-Za-z]:[\\/]/.test(selfRelativePath) ||
    /^[/\\]{2}/.test(selfRelativePath)
  ) {
    return null;
  }
  const self = normalize(selfRelativePath);
  if (self === ".." || self.startsWith(`..${sep}`)) return null;
  return { directory: dirname(self), self };
}

function relativeCandidateTargets(
  candidates: readonly string[],
  selfRelativePath: string | undefined,
): ReadonlyMap<string, readonly string[]> {
  const viewedFile = viewedFileDirectory(selfRelativePath);
  const targets = new Map<string, readonly string[]>();
  for (const candidate of candidates) {
    const rootRelative = viewedFile
      ? VIEWED_FILE_ROOT_PREFIX.exec(candidate)?.[1]
      : undefined;
    const projectTarget = viewedFile
      ? normalize(rootRelative ?? candidate)
      : candidate;
    if (viewedFile && projectTarget === viewedFile.self) continue;

    const ordered = [projectTarget];
    if (viewedFile) {
      const fileTarget = join(viewedFile.directory, projectTarget);
      if (fileTarget !== projectTarget && fileTarget !== viewedFile.self) {
        ordered.push(fileTarget);
      }
    }
    targets.set(candidate, ordered);
  }
  return targets;
}

async function resolveProjectPathCandidates(
  relativeCandidates: readonly string[],
  absoluteCandidates: readonly string[],
  options: ProjectPathLinkOptions,
): Promise<ResolvedProjectPathCandidates | null> {
  const {
    index,
    projectId,
    selfRelativePath,
    gateLookupsByShape,
    knownAbsoluteFilePaths,
    onUnversionedLookup,
    resolveAbsoluteFilePaths,
  } = options;
  const externalViewedFile = externalViewedFileDirectory(options);
  const candidateTargets = externalViewedFile
    ? new Map<string, readonly string[]>()
    : relativeCandidateTargets(relativeCandidates, selfRelativePath);
  const worthLookup = Array.from(
    new Set(
      relativeCandidates
        .filter((candidate) =>
          gateLookupsByShape ? mayCostLookup(candidate) : true,
        )
        .flatMap((candidate) => candidateTargets.get(candidate) ?? []),
    ),
  );

  const absoluteTargets = new Map(
    Array.from(new Set(absoluteCandidates))
      .slice(0, MAX_ABSOLUTE_PATH_PROBES)
      .map((token) => [token, absoluteTokenTargets(token)] as const),
  );
  const cappedAbsoluteCandidates = Array.from(
    new Set(
      [...absoluteTargets.values()].flatMap((targets) =>
        targets.map((target) => target.filePath),
      ),
    ),
  );
  const absoluteHits = (
    existing: ReadonlySet<string>,
  ): ReadonlyMap<string, AbsoluteFileTarget> => {
    const hits = new Map<string, AbsoluteFileTarget>();
    for (const [token, targets] of absoluteTargets) {
      const hit = targets.find((target) => existing.has(target.filePath));
      if (hit) hits.set(token, hit);
    }
    return hits;
  };
  const externalCandidateTargets =
    projectId && (knownAbsoluteFilePaths || resolveAbsoluteFilePaths)
      ? externalRelativeCandidateTargets(
          relativeCandidates,
          options,
          MAX_ABSOLUTE_PATH_PROBES - cappedAbsoluteCandidates.length,
        )
      : new Map<string, string>();
  const directlyProbedPaths = Array.from(
    new Set([
      ...cappedAbsoluteCandidates,
      ...externalCandidateTargets.values(),
    ]),
  ).slice(0, MAX_ABSOLUTE_PATH_PROBES);
  const relative = new Map<string, string>();
  if (options.pathDiscovery === "known-only") {
    for (const candidate of relativeCandidates) {
      const target = candidateTargets
        .get(candidate)
        ?.find((path) => index.knownFile(path) === true);
      if (target) relative.set(candidate, target);
    }
    const known = new Set(knownAbsoluteFilePaths?.(directlyProbedPaths) ?? []);
    const externalRelative = new Map<string, string>();
    for (const [candidate, target] of externalCandidateTargets) {
      if (known.has(target)) externalRelative.set(candidate, target);
    }
    if (directlyProbedPaths.length > 0) onUnversionedLookup?.();
    return { absolute: absoluteHits(known), externalRelative, relative };
  }
  let absolute = new Set<string>();
  try {
    const [existingRelative, existingAbsolute] = await Promise.all([
      externalViewedFile
        ? Promise.resolve(new Set<string>())
        : index.findExisting(worthLookup),
      directlyProbedPaths.length > 0
        ? resolveAbsoluteFilePaths?.(directlyProbedPaths)
        : undefined,
    ]);
    for (const candidate of relativeCandidates) {
      const target = candidateTargets
        .get(candidate)
        ?.find((path) => existingRelative.has(path));
      if (target) relative.set(candidate, target);
    }
    absolute = new Set(existingAbsolute);
  } catch {
    // Link discovery is advisory. An unavailable index or exact resolver must
    // not fail the view that owns the source text.
    onUnversionedLookup?.();
    return null;
  }

  if (worthLookup.some((path) => index.knownFile(path) === undefined)) {
    onUnversionedLookup?.();
  }
  if (directlyProbedPaths.length > 0) {
    onUnversionedLookup?.();
  }
  if (gateLookupsByShape) {
    // A token not worth a lookup is still worth an answer the cache already
    // holds, which is what keeps `Makefile` and `LICENSE` linking.
    for (const candidate of relativeCandidates) {
      if (mayCostLookup(candidate)) continue;
      const target = candidateTargets
        .get(candidate)
        ?.find((path) => index.knownFile(path) === true);
      if (target) {
        relative.set(candidate, target);
      }
    }
  }

  const externalRelative = new Map<string, string>();
  for (const [candidate, target] of externalCandidateTargets) {
    if (absolute.has(target)) externalRelative.set(candidate, target);
  }

  return { absolute: absoluteHits(absolute), externalRelative, relative };
}

/** Resolve raw command/result text to a small exact-link annotation. */
export async function resolveProjectPathTextLinks(
  text: string,
  options: ProjectPathLinkOptions,
): Promise<ProjectPathLinkTarget[]> {
  if (!text) return [];

  const tokens = findProjectPathTokens(text);
  const relativeCandidates = Array.from(
    new Set(
      tokens
        .filter((token) => token.kind === "relative")
        .map((token) => token.text)
        .filter((token) => token !== options.selfRelativePath),
    ),
  );
  const absoluteCandidates =
    options.projectId &&
    (options.knownAbsoluteFilePaths || options.resolveAbsoluteFilePaths)
      ? Array.from(
          new Set(
            tokens
              .filter(
                (token) =>
                  token.kind === "absolute" &&
                  mayCostAbsoluteLookup(token.text),
              )
              .map((token) => token.text),
          ),
        ).slice(0, MAX_ABSOLUTE_PATH_PROBES)
      : [];
  if (relativeCandidates.length === 0 && absoluteCandidates.length === 0) {
    return [];
  }

  const resolved = await resolveProjectPathCandidates(
    relativeCandidates,
    absoluteCandidates,
    options,
  );
  if (!resolved) return [];

  const targets = new Map<string, ProjectPathLinkTarget>();
  for (const token of tokens) {
    const filePath =
      token.kind === "absolute"
        ? resolved.absolute.get(token.text)?.filePath
        : (resolved.externalRelative.get(token.text) ??
          resolved.relative.get(token.text));
    if (!filePath || targets.has(token.text)) continue;
    targets.set(token.text, {
      filePath,
      text: token.text,
    });
  }
  return Array.from(targets.values());
}

/**
 * Hydrate the index for every path-shaped token in raw source text.
 *
 * Rendering asks about membership synchronously — the inline-code file linker
 * has no place to await — so one batched asynchronous pass over the source runs
 * first and turns those later questions into cache hits. Batching is also what
 * lets the index list a directory once instead of probing each name in it.
 */
export async function resolveShapedPaths(
  text: string,
  index: ProjectPathIndex,
): Promise<boolean> {
  const shaped = new Set<string>();
  PATH_TOKEN.lastIndex = 0;
  let match: RegExpExecArray | null = PATH_TOKEN.exec(text);
  while (match !== null) {
    const trimmed = match[0].replace(TRAILING_NOISE, "");
    if (trimmed && mayCostLookup(trimmed)) shaped.add(trimmed);
    match = PATH_TOKEN.exec(text);
  }
  if (shaped.size === 0) return true;
  const paths = Array.from(shaped);
  await index.findExisting(paths);
  return paths.every((path) => index.knownFile(path) !== undefined);
}

interface HtmlPathOccurrence extends ProjectPathToken {
  /** Existing anchors must never acquire a nested exact-file link. */
  exact: boolean;
  /** Only prose, including generated inline-code links, supplies context. */
  directoryContext: boolean;
  code: boolean;
}

/** Extract once; exact linking and directory resolution consume these offsets. */
function scanHtmlProjectPaths(
  html: string,
  mentionedDirectories: boolean,
): HtmlPathOccurrence[] {
  const tokens: HtmlPathOccurrence[] = [];
  const excluded: string[] = [];
  let codeDepth = 0;
  let anchorDepth = 0;
  for (const match of html.matchAll(/<!--[\s\S]*?-->|<[^>]*>|[^<]+/g)) {
    const part = match[0];
    if (part.startsWith("<")) {
      const tag = tagName(part);
      if (!tag) continue;
      if (tag.closing) {
        if (tag.name === "a") anchorDepth = Math.max(0, anchorDepth - 1);
        if (excluded.at(-1) === tag.name) excluded.pop();
        if (tag.name === "code") codeDepth = Math.max(0, codeDepth - 1);
      } else {
        if (tag.name === "a") anchorDepth += 1;
        if (tag.name === "code") codeDepth += 1;
        const generatedCodeLink =
          tag.name === "a" &&
          part.includes('class="fixed-font-file-link"') &&
          part.includes('data-ya-resource="project-file"');
        if (
          ["pre", "script", "style", "textarea", "math", "annotation"].includes(
            tag.name,
          ) ||
          (tag.name === "a" && !generatedCodeLink) ||
          (tag.name === "span" && /class="[^"]*\bkatex\b/.test(part))
        ) {
          excluded.push(tag.name);
        } else if (excluded.at(-1) === tag.name) {
          excluded.push(tag.name);
        }
      }
      continue;
    }
    const directoryContext = mentionedDirectories && excluded.length === 0;
    if (anchorDepth > 0 && !directoryContext) continue;
    for (const token of findProjectPathTokens(part)) {
      tokens.push({
        ...token,
        text:
          token.kind === "absolute" ? decodeHtmlText(token.text) : token.text,
        start: match.index + token.start,
        end: match.index + token.end,
        exact: anchorDepth === 0,
        directoryContext: directoryContext && token.kind === "relative",
        code: codeDepth > 0,
      });
    }
  }
  return tokens;
}

/** Resolve context from the same occurrences used for exact links. */
async function resolveMentionedDirectoryFiles(
  occurrences: readonly HtmlPathOccurrence[],
  options: ProjectPathLinkOptions,
): Promise<ReadonlyMap<HtmlPathOccurrence, string>> {
  const targets = new Map<HtmlPathOccurrence, string>();
  if (!options.mentionedDirectories || options.pathDiscovery === "known-only")
    return targets;
  const tokens = occurrences.filter((token) => token.directoryContext);
  const directories = [
    ...new Set(
      tokens
        .filter((token) => token.code || token.text.includes("/"))
        .map((token) => token.text),
    ),
  ].slice(0, 64);
  if (directories.length === 0) return targets;
  const { index } = options;
  try {
    const existingDirectories = await index.findExisting(
      directories,
      "directory",
    );
    if (directories.some((path) => index.knownFile(path) === undefined)) {
      options.onUnversionedLookup?.();
    }
    if (existingDirectories.size === 0) return targets;
    let directory: string | undefined;
    const candidates = new Map<HtmlPathOccurrence, string>();
    const paths = new Set<string>();
    for (const token of tokens) {
      if (existingDirectories.has(token.text)) {
        directory = token.text;
      } else if (
        directory &&
        !/[\\/]/.test(token.text) &&
        (token.code || mayCostLookup(token.text))
      ) {
        const path = join(directory, token.text);
        if (!paths.has(path) && paths.size >= 512) continue;
        paths.add(path);
        candidates.set(token, path);
      }
    }
    const existingFiles = await index.findExisting([...paths]);
    if ([...paths].some((path) => index.knownFile(path) === undefined)) {
      options.onUnversionedLookup?.();
    }
    for (const [token, path] of candidates) {
      if (existingFiles.has(path)) targets.set(token, path);
    }
    return targets;
  } catch {
    // Filesystem discovery is advisory; preserve the original readable body.
    options.onUnversionedLookup?.();
    return targets;
  }
}

/**
 * Link every project-relative path occurring in already-highlighted HTML.
 * Returns the input unchanged when the project has no indexed paths, so an
 * unavailable index degrades to today's plain content rather than an error.
 */
export async function linkifyProjectPaths(
  html: string,
  options: ProjectPathLinkOptions,
): Promise<string> {
  if (!html) return html;
  const {
    projectPath,
    projectId,
    knownAbsoluteFilePaths,
    selfRelativePath,
    resolveAbsoluteFilePaths,
  } = options;
  const occurrences = scanHtmlProjectPaths(
    html,
    options.mentionedDirectories === true,
  );
  const relativeCandidates = [
    ...new Set(
      occurrences
        .filter(
          (token) =>
            token.exact &&
            token.kind === "relative" &&
            token.text !== selfRelativePath,
        )
        .map((token) => token.text),
    ),
  ];
  const absoluteCandidates =
    projectId && (knownAbsoluteFilePaths || resolveAbsoluteFilePaths)
      ? [
          ...new Set(
            occurrences
              .filter(
                (token) =>
                  token.exact &&
                  token.kind === "absolute" &&
                  mayCostAbsoluteLookup(token.text),
              )
              .map((token) => token.text),
          ),
        ].slice(0, MAX_ABSOLUTE_PATH_PROBES)
      : [];
  if (occurrences.length === 0) {
    return html;
  }

  const [resolved, directoryFiles] = await Promise.all([
    resolveProjectPathCandidates(
      relativeCandidates,
      absoluteCandidates,
      options,
    ),
    resolveMentionedDirectoryFiles(occurrences, options),
  ]);
  let out = "";
  let cursor = 0;
  for (const token of occurrences) {
    const directoryFile = directoryFiles.get(token);
    const externalRelativeTarget =
      token.exact && token.kind === "relative"
        ? resolved?.externalRelative.get(token.text)
        : undefined;
    const absoluteTarget =
      token.exact && token.kind === "absolute"
        ? resolved?.absolute.get(token.text)
        : externalRelativeTarget
          ? { filePath: externalRelativeTarget }
          : undefined;
    const projectTarget =
      token.exact && token.kind === "relative"
        ? resolved?.relative.get(token.text)
        : undefined;
    let replacement =
      absoluteTarget && projectId
        ? renderProjectFileViewerLink(projectId, absoluteTarget, token.text)
        : projectTarget
          ? renderLocalFileLink(
              { filePath: resolve(projectPath, projectTarget) },
              html.slice(token.start, token.end),
              { title: token.text },
            )
          : undefined;
    if (directoryFile) {
      // Keep the exact-link fallback inside the marker for older clients and
      // for clients that disable directory context. Emit both in one splice.
      replacement = `<span data-ya-directory-file="${escapeHtml(directoryFile)}">${replacement ?? html.slice(token.start, token.end)}</span>`;
    }
    if (!replacement) continue;
    out += html.slice(cursor, token.start) + replacement;
    cursor = token.end;
  }
  return cursor ? out + html.slice(cursor) : html;
}
