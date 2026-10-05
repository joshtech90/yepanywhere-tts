/**
 * The assets a shared HTML root references directly, as one decision shared by
 * the server that authorizes them and the play page that inlines them.
 *
 * A reference counts only through the element that loads it: a stylesheet or
 * icon `link`, a `script src`, and the media sources of `img`, `source`, and
 * `video`. A document linked with `<a href>` or named in CSS is not an asset
 * of the root. The root's own directory is its site root, so `/assets/app.js`
 * and `assets/app.js` name the same file from a root at `dist/index.html`.
 */

/** Images and video an HTML or Markdown root may display directly. */
export const PUBLIC_SHARE_MEDIA_ASSET_EXTENSIONS: ReadonlySet<string> = new Set(
  [
    ".apng",
    ".avif",
    ".avi",
    ".bmp",
    ".gif",
    ".ico",
    ".jpeg",
    ".jpg",
    ".mkv",
    ".mov",
    ".mp4",
    ".ogv",
    ".png",
    ".svg",
    ".tif",
    ".tiff",
    ".webm",
    ".webp",
  ],
);
const SCRIPT_EXTENSIONS: ReadonlySet<string> = new Set([".js", ".mjs"]);
const STYLESHEET_EXTENSIONS: ReadonlySet<string> = new Set([".css"]);

/** One directly referenced asset of an HTML root. */
export interface HtmlRootAssetReference {
  /** Project-relative path the reference names. */
  path: string;
  /** Span of the attribute value in the source, excluding its quotes. */
  start: number;
  end: number;
  /** Whether the value was written in quotes. */
  quoted: boolean;
}

interface ScannedAttribute {
  value: string;
  start: number;
  end: number;
  quoted: boolean;
}

/** Elements whose text content is not markup, so no tag inside it counts. */
const RAW_TEXT_ELEMENTS = new Set(["script", "style", "textarea", "title"]);

/**
 * Find the assets an HTML root references directly, in source order. Each
 * reference is resolved against `rootPath` (the root's project-relative path)
 * and kept only when it names a project file of the kind its element loads.
 */
export function findHtmlRootAssetReferences(
  html: string,
  rootPath: string,
): HtmlRootAssetReference[] {
  const references: HtmlRootAssetReference[] = [];
  const add = (
    attribute: ScannedAttribute | undefined,
    extensions: ReadonlySet<string>,
  ) => {
    if (!attribute) return;
    const path = resolveHtmlRootAssetPath(
      rootPath,
      decodeHtmlAttributeValue(attribute.value),
    );
    if (!path || !extensions.has(pathExtension(path))) return;
    references.push({
      path,
      start: attribute.start,
      end: attribute.end,
      quoted: attribute.quoted,
    });
  };

  let index = 0;
  while (index < html.length) {
    const open = html.indexOf("<", index);
    if (open < 0) break;
    if (html.startsWith("<!--", open)) {
      const close = html.indexOf("-->", open + 4);
      index = close < 0 ? html.length : close + 3;
      continue;
    }
    const nameMatch = /^<([A-Za-z][^\s/>]*)/.exec(html.slice(open, open + 64));
    if (!nameMatch) {
      // End tags, doctype and processing instructions carry no references.
      const close = html.indexOf(">", open + 1);
      index = close < 0 ? html.length : close + 1;
      continue;
    }
    const name = nameMatch[1]!.toLowerCase();
    const { attributes, end } = scanAttributes(
      html,
      open + nameMatch[0].length,
    );
    index = end;

    if (name === "script") {
      add(attributes.get("src"), SCRIPT_EXTENSIONS);
    } else if (name === "link") {
      const rel = (attributes.get("rel")?.value ?? "")
        .toLowerCase()
        .split(/\s+/);
      if (rel.includes("stylesheet"))
        add(attributes.get("href"), STYLESHEET_EXTENSIONS);
      else if (rel.includes("icon"))
        add(attributes.get("href"), PUBLIC_SHARE_MEDIA_ASSET_EXTENSIONS);
    } else if (name === "img" || name === "source") {
      add(attributes.get("src"), PUBLIC_SHARE_MEDIA_ASSET_EXTENSIONS);
    } else if (name === "video") {
      add(attributes.get("src"), PUBLIC_SHARE_MEDIA_ASSET_EXTENSIONS);
      add(attributes.get("poster"), PUBLIC_SHARE_MEDIA_ASSET_EXTENSIONS);
    }

    if (RAW_TEXT_ELEMENTS.has(name)) {
      const closing = new RegExp(`</${name}[\\s/>]`, "i").exec(
        html.slice(index),
      );
      index = closing ? index + closing.index : html.length;
    }
  }
  return references;
}

/**
 * The path an HTML root's reference names, in the root path's own form:
 * project-relative for a project-relative root, absolute for an absolute one.
 * Null when it names nothing the share could serve: another origin or scheme,
 * a fragment, or a path above the project (or filesystem) root. A leading `/`
 * resolves from the root's own directory, as a browser serving that directory
 * as its site would.
 */
export function resolveHtmlRootAssetPath(
  rootPath: string,
  reference: string,
): string | null {
  const trimmed = reference.trim().replaceAll("\\", "/");
  if (
    !trimmed ||
    trimmed.startsWith("#") ||
    trimmed.startsWith("//") ||
    /^[a-z][a-z0-9+.-]*:/i.test(trimmed)
  ) {
    return null;
  }
  const pathOnly = trimmed.split(/[?#]/, 1)[0] ?? "";
  if (!pathOnly) return null;
  const root = rootPath.replaceAll("\\", "/");
  const prefix = /^(?:[A-Za-z]:)?\//.exec(root)?.[0] ?? "";
  const parts = root
    .slice(prefix.length)
    .split("/")
    .slice(0, -1)
    .filter(Boolean);
  // Above the site root a browser stays at it; above the project root a
  // relative reference names a file the share can never serve.
  const floor = pathOnly.startsWith("/") ? parts.length : 0;
  for (const rawSegment of pathOnly.split("/")) {
    const segment = decodePathSegment(rawSegment);
    if (segment === null) return null;
    if (!segment || segment === ".") continue;
    if (segment === "..") {
      if (parts.length > floor) parts.pop();
      else if (floor === 0) return null;
      continue;
    }
    parts.push(segment);
  }
  return parts.length > 0 ? `${prefix}${parts.join("/")}` : null;
}

function scanAttributes(
  html: string,
  from: number,
): { attributes: Map<string, ScannedAttribute>; end: number } {
  const attributes = new Map<string, ScannedAttribute>();
  let index = from;
  while (index < html.length) {
    while (index < html.length && /[\s/]/.test(html[index]!)) index++;
    if (index >= html.length) break;
    if (html[index] === ">") return { attributes, end: index + 1 };
    const nameStart = index;
    while (index < html.length && !/[\s/>=]/.test(html[index]!)) index++;
    const name = html.slice(nameStart, index).toLowerCase();
    while (index < html.length && /\s/.test(html[index]!)) index++;
    if (html[index] !== "=") {
      if (name && !attributes.has(name))
        attributes.set(name, {
          value: "",
          start: index,
          end: index,
          quoted: false,
        });
      continue;
    }
    index++;
    while (index < html.length && /\s/.test(html[index]!)) index++;
    const quote = html[index];
    let attribute: ScannedAttribute;
    if (quote === '"' || quote === "'") {
      const close = html.indexOf(quote, index + 1);
      const end = close < 0 ? html.length : close;
      attribute = {
        value: html.slice(index + 1, end),
        start: index + 1,
        end,
        quoted: true,
      };
      index = close < 0 ? html.length : close + 1;
    } else {
      const start = index;
      while (index < html.length && !/[\s>]/.test(html[index]!)) index++;
      attribute = {
        value: html.slice(start, index),
        start,
        end: index,
        quoted: false,
      };
    }
    // The first of two same-named attributes is the one a browser keeps.
    if (name && !attributes.has(name)) attributes.set(name, attribute);
  }
  return { attributes, end: html.length };
}

const NAMED_CHARACTER_REFERENCES: Record<string, string> = {
  amp: "&",
  apos: "'",
  gt: ">",
  lt: "<",
  quot: '"',
};

function decodeHtmlAttributeValue(value: string): string {
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
      return NAMED_CHARACTER_REFERENCES[entity.toLowerCase()] ?? match;
    },
  );
}

/** A percent-decoded path segment, or null when it cannot name one file. */
function decodePathSegment(segment: string): string | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(segment);
  } catch {
    return null;
  }
  return /[/\\\0]/.test(decoded) ? null : decoded;
}

function pathExtension(path: string): string {
  const name = path.slice(path.lastIndexOf("/") + 1);
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot).toLowerCase() : "";
}
