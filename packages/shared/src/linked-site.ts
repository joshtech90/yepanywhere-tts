/**
 * The files a shared root page links to, followed transitively, and the URL
 * path each answers at when the root is served at `/`.
 *
 * One walk decides both what a file vhost serves and what a live public file
 * share authorizes. Every reference counts — an element's `src`, an
 * `<a href>`, a CSS `url()`, a Markdown link or image — so a reader can follow
 * the page's own links. Only HTML, Markdown and CSS documents are read for
 * further references; any other target is a leaf.
 *
 * A reference is resolved twice. On disk it resolves against the referring
 * document's own path, with a leading `/` naming the root's directory; it may
 * leave that directory and any project. As a URL it resolves the way a
 * browser would against the URL the document is served at, collapsing `..`
 * at `/`. That URL then maps to the file on disk, so the root keeps the
 * short address `/` while `../../topics/x.md` still reaches its file (at
 * `/topics/x.md`). When two files resolve to one URL, the first found keeps
 * it.
 */

export type LinkedDocumentKind = "html" | "markdown" | "css";

const DOCUMENT_KINDS: Readonly<Record<string, LinkedDocumentKind>> = {
  ".css": "css",
  ".htm": "html",
  ".html": "html",
  ".markdown": "markdown",
  ".md": "markdown",
  ".mdx": "markdown",
  ".qmd": "markdown",
  ".xhtml": "html",
};

/** The document kind a walk reads for references, or null for a leaf. */
export function linkedDocumentKind(path: string): LinkedDocumentKind | null {
  const name = path.slice(path.lastIndexOf("/") + 1);
  const dot = name.lastIndexOf(".");
  return dot > 0
    ? (DOCUMENT_KINDS[name.slice(dot).toLowerCase()] ?? null)
    : null;
}

/** One file a root reaches, with every URL path that serves it. */
export interface LinkedSiteFile {
  /** Absolute path, `/`-separated. */
  path: string;
  /** URL paths answering with this file; the first is where it was found. */
  urls: string[];
}

export interface LinkedSite {
  /** Every servable file, the root first, in the order found. */
  files: LinkedSiteFile[];
  /** URL path to absolute file path. */
  urls: ReadonlyMap<string, string>;
  /** A limit stopped the walk before it had followed every link. */
  truncated: boolean;
}

export interface LinkedSiteLimits {
  /** Most files a site may reach, the root included. */
  maxFiles: number;
  /** Most documents read for further references. */
  maxDocuments: number;
}

export const LINKED_SITE_LIMITS: LinkedSiteLimits = {
  maxFiles: 2000,
  maxDocuments: 200,
};

/**
 * What a walk may serve at `path`: null when nothing servable is there (it is
 * missing, refused by policy, or not a regular file). `content` is the text of
 * a document when `document` is true and it is small enough to scan; a
 * document without it is served but not followed.
 */
export type LinkedSiteInspector = (
  path: string,
  document: boolean,
) => Promise<{ content?: string } | null>;

/**
 * Walk everything `rootPath` links to. The root answers at `/` and at its own
 * name, `/<basename>`.
 */
export async function walkLinkedSite(
  rootPath: string,
  inspect: LinkedSiteInspector,
  limits: LinkedSiteLimits = LINKED_SITE_LIMITS,
): Promise<LinkedSite> {
  const root = splitAbsolutePath(rootPath);
  const files: LinkedSiteFile[] = [];
  const byPath = new Map<string, LinkedSiteFile>();
  const urls = new Map<string, string>();
  let truncated = false;
  if (!root || root.segments.length === 0) return { files, urls, truncated };
  const siteRootPath = joinAbsolutePath(
    root.prefix,
    root.segments.slice(0, -1),
  );
  const rootName = root.segments[root.segments.length - 1]!;

  const queue: Array<{ file: LinkedSiteFile; content: string }> = [];
  let documentsRead = 0;
  const add = async (path: string, url: string): Promise<void> => {
    const kind = linkedDocumentKind(path);
    const readDocument = kind !== null && documentsRead < limits.maxDocuments;
    if (kind !== null && !readDocument) truncated = true;
    const inspected = await inspect(path, readDocument);
    if (!inspected) return;
    const file: LinkedSiteFile = { path, urls: [url] };
    files.push(file);
    byPath.set(path, file);
    urls.set(url, path);
    if (readDocument && inspected.content !== undefined) {
      documentsRead++;
      queue.push({ file, content: inspected.content });
    }
  };

  const rootFile = joinAbsolutePath(root.prefix, root.segments);
  await add(rootFile, "/");
  const found = byPath.get(rootFile);
  if (!found) return { files, urls, truncated };
  found.urls.push(`/${rootName}`);
  urls.set(`/${rootName}`, rootFile);

  while (queue.length > 0) {
    const { file, content } = queue.shift()!;
    const kind = linkedDocumentKind(file.path)!;
    const urlDirectory = file.urls[0]!.split("/").filter(Boolean);
    if (!file.urls[0]!.endsWith("/")) urlDirectory.pop();
    for (const raw of findLinkedReferences(content, kind)) {
      const reference = parseLocalReference(raw);
      if (!reference) continue;
      const url = resolveSegments(
        reference.absolute ? [] : urlDirectory,
        reference.segments,
        true,
      );
      const path = resolveLinkedReference(file.path, siteRootPath, raw);
      if (!url || !path) continue;
      const urlPath = `/${url.join("/")}`;
      if (urls.has(urlPath)) continue;
      const known = byPath.get(path);
      if (known) {
        known.urls.push(urlPath);
        urls.set(urlPath, path);
        continue;
      }
      if (files.length >= limits.maxFiles) {
        truncated = true;
        continue;
      }
      await add(path, urlPath);
    }
  }
  return { files, urls, truncated };
}

/**
 * The absolute file `reference` names from the document at `documentPath`, as
 * a walk resolves it on disk: against the document's folder, or from
 * `siteRoot` for a leading `/`, free to leave both. Null when it names no file
 * on this server: another origin or scheme, a fragment alone, a folder, or a
 * path above the filesystem root.
 */
export function resolveLinkedReference(
  documentPath: string,
  siteRoot: string,
  reference: string,
): string | null {
  const parsed = parseLocalReference(reference);
  const document = splitAbsolutePath(documentPath);
  const site = splitAbsolutePath(siteRoot);
  if (!parsed || !document || !site) return null;
  const segments = resolveSegments(
    parsed.absolute ? site.segments : document.segments.slice(0, -1),
    parsed.segments,
    false,
  );
  return segments ? joinAbsolutePath(document.prefix, segments) : null;
}

/**
 * The raw reference strings a document names, in source order and without
 * duplicates. Markdown code blocks are skipped; inline HTML in Markdown
 * counts as HTML.
 */
export function findLinkedReferences(
  content: string,
  kind: LinkedDocumentKind,
): string[] {
  const references = new Set<string>();
  const add = (value: string | undefined) => {
    const trimmed = value?.trim();
    if (trimmed) references.add(trimmed);
  };
  const addCss = (text: string) => {
    for (const match of text.matchAll(CSS_URL_PATTERN))
      add(decodeCssEscapes(match[2] ?? ""));
    for (const match of text.matchAll(CSS_IMPORT_PATTERN)) add(match[2]);
  };
  const addHtml = (text: string) => {
    for (const match of text.matchAll(HTML_REFERENCE_PATTERN)) {
      const name = match[1]!.toLowerCase();
      const value = decodeHtmlEntities(match[2] ?? match[3] ?? match[4] ?? "");
      if (name === "srcset") {
        for (const candidate of value.split(","))
          add(candidate.trim().split(/\s+/, 1)[0]);
      } else add(value);
    }
    addCss(text);
  };

  if (kind === "css") addCss(content);
  else if (kind === "html") addHtml(content);
  else {
    const prose = content.replace(FENCED_CODE_PATTERN, "");
    for (const match of prose.matchAll(MARKDOWN_LINK_PATTERN)) add(match[1]);
    for (const match of prose.matchAll(MARKDOWN_DEFINITION_PATTERN))
      add(match[1]);
    for (const match of prose.matchAll(QUARTO_INCLUDE_PATTERN))
      add(match[1] ?? match[2] ?? match[3]);
    addHtml(prose);
  }
  return [...references];
}

const HTML_REFERENCE_PATTERN =
  /(?<![\w:-])(href|src|poster|srcset|data|xlink:href)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'<>`=]+))/gi;
const CSS_URL_PATTERN = /\burl\(\s*(["']?)([^"')]+)\1\s*\)/gi;
const CSS_IMPORT_PATTERN = /@import\s+(["'])([^"']+)\1/gi;
const MARKDOWN_LINK_PATTERN =
  /!?\[[^\]]*\]\(\s*<?([^)\s>]+)>?(?:\s+(?:"[^"]*"|'[^']*'|\([^)]*\)))?\s*\)/g;
const MARKDOWN_DEFINITION_PATTERN = /^ {0,3}\[[^\]]+\]:\s*<?([^\s>]+)>?/gm;
const QUARTO_INCLUDE_PATTERN =
  /\{\{<\s*include\s+(?:"([^"]+)"|'([^']+)'|([^\s"'<>]+))\s*>\}\}/g;
const FENCED_CODE_PATTERN =
  /^ {0,3}(`{3,}|~{3,})[^\n]*\n[\s\S]*?(?:^ {0,3}\1[`~]*[ \t]*$|(?![\s\S]))/gm;

/**
 * The path a reference names on this server, or null when it names nothing a
 * site can serve: another origin or scheme, a fragment alone, or a folder.
 */
function parseLocalReference(
  raw: string,
): { absolute: boolean; segments: string[] } | null {
  const reference = raw.replaceAll("\\", "/");
  if (
    reference.startsWith("#") ||
    reference.startsWith("//") ||
    /^[a-z][a-z0-9+.-]*:/i.test(reference)
  )
    return null;
  const pathOnly = reference.split(/[?#]/, 1)[0] ?? "";
  if (!pathOnly || pathOnly.endsWith("/")) return null;
  const segments: string[] = [];
  for (const segment of pathOnly.split("/")) {
    let decoded: string;
    try {
      decoded = decodeURIComponent(segment);
    } catch {
      return null;
    }
    if (/[/\\\0]/.test(decoded)) return null;
    segments.push(decoded);
  }
  return { absolute: pathOnly.startsWith("/"), segments };
}

/**
 * `base` joined with `segments`. `..` above the start stays there for a URL,
 * as a browser does, and fails for a path on disk.
 */
function resolveSegments(
  base: readonly string[],
  segments: readonly string[],
  collapse: boolean,
): string[] | null {
  const parts = [...base];
  for (const segment of segments) {
    if (!segment || segment === ".") continue;
    if (segment === "..") {
      if (parts.length > 0) parts.pop();
      else if (!collapse) return null;
      continue;
    }
    parts.push(segment);
  }
  return parts.length > 0 ? parts : null;
}

function splitAbsolutePath(
  path: string,
): { prefix: string; segments: string[] } | null {
  const normalized = path.replaceAll("\\", "/");
  const prefix = /^(?:[A-Za-z]:)?\//.exec(normalized)?.[0];
  if (!prefix) return null;
  return {
    prefix,
    segments: normalized.slice(prefix.length).split("/").filter(Boolean),
  };
}

function joinAbsolutePath(prefix: string, segments: readonly string[]): string {
  return `${prefix}${segments.join("/")}`;
}

const NAMED_ENTITIES: Readonly<Record<string, string>> = {
  amp: "&",
  apos: "'",
  gt: ">",
  lt: "<",
  quot: '"',
};

function decodeHtmlEntities(value: string): string {
  return value.replace(
    /&(#[0-9]+|#x[0-9a-f]+|[a-z]+);/gi,
    (match, entity: string) => {
      if (entity.startsWith("#")) {
        const codePoint =
          entity[1] === "x" || entity[1] === "X"
            ? Number.parseInt(entity.slice(2), 16)
            : Number.parseInt(entity.slice(1), 10);
        return codePoint > 0 && codePoint <= 0x10ffff
          ? String.fromCodePoint(codePoint)
          : match;
      }
      return NAMED_ENTITIES[entity.toLowerCase()] ?? match;
    },
  );
}

function decodeCssEscapes(value: string): string {
  return value.replace(/\\([0-9a-f]{1,6}\s?|.)/gi, (match, escaped: string) => {
    if (!/^[0-9a-f]/i.test(escaped)) return escaped;
    const codePoint = Number.parseInt(escaped.trim(), 16);
    return codePoint > 0 && codePoint <= 0x10ffff
      ? String.fromCodePoint(codePoint)
      : match;
  });
}
