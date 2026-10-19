import {
  buildProjectFileViewerHref,
  type CitedFilePosition,
  findProjectPathTokens,
  type ProjectPathLinkTarget,
  readLeadingCitedPosition,
  splitTrailingCitedPosition,
} from "@yep-anywhere/shared";
import {
  buildPublicShareFileHref,
  type PublicShareContextValue,
} from "../contexts/PublicShareContext";
import type { ProjectPathLinkSettings } from "./projectPathLinkPreferences";

export interface AnnotatedProjectPathLinksHtml {
  changed: boolean;
  html: string;
}

/**
 * Point one anchor at the file, through whichever route this viewer may use.
 *
 * Returns false when a public-share viewer cannot reach the file — outside the
 * share's project — so the caller leaves the text alone rather than minting a
 * link that only the owner could follow.
 */
function setProjectPathAnchorTarget(
  anchor: HTMLAnchorElement,
  projectId: string,
  filePath: string,
  publicShare: PublicShareContextValue | null | undefined,
): boolean {
  if (publicShare) {
    const shareHref = buildPublicShareFileHref(publicShare, { filePath });
    if (!shareHref) return false;
    anchor.setAttribute("href", shareHref);
    anchor.dataset.publicShareFileLink = "true";
  } else {
    anchor.setAttribute(
      "href",
      buildProjectFileViewerHref({ projectId, filePath }),
    );
    anchor.dataset.yaPrivateProjectFileLink = "true";
  }
  anchor.dataset.yaResource = "project-file";
  anchor.dataset.yaProjectId = projectId;
  anchor.dataset.yaPath = filePath;
  anchor.title = `${filePath}\nClick to view, or use a browser link gesture to open this file`;
  return true;
}

/** Link basename occurrences inside one already-sanitized HTML fragment. */
export function annotateProjectPathLinksHtml(
  html: string,
  links: readonly ProjectPathLinkTarget[] | undefined,
  projectId: string | undefined,
  publicShare?: PublicShareContextValue | null,
  settings: Pick<
    ProjectPathLinkSettings,
    "projectPaths" | "mentionedDirectories"
  > = { projectPaths: true, mentionedDirectories: true },
): AnnotatedProjectPathLinksHtml {
  const mayCitePosition = MAY_CITE_POSITION.test(html);
  if (
    !html ||
    (!links?.length &&
      settings.projectPaths &&
      !mayCitePosition &&
      !html.includes("data-ya-directory-file")) ||
    !projectId ||
    typeof document === "undefined"
  ) {
    return { changed: false, html };
  }

  const targets = new Map(links?.map((link) => [link.text, link.filePath]));
  const template = document.createElement("template");
  template.innerHTML = html;
  let changed = false;
  const finish = (): AnnotatedProjectPathLinksHtml => {
    if (mayCitePosition && splitCitedFileLinks(template.content)) {
      changed = true;
    }
    return { changed, html: changed ? template.innerHTML : html };
  };

  if (!settings.projectPaths && !publicShare) {
    for (const anchor of template.content.querySelectorAll(
      'a[data-ya-resource="project-file"], a[data-ya-resource="local-file"], a[data-fixed-font-file-path]',
    )) {
      anchor.replaceWith(...anchor.childNodes);
      changed = true;
    }
    return { changed, html: changed ? template.innerHTML : html };
  }

  const directoryAnchors = new Set<HTMLAnchorElement>();
  if (settings.mentionedDirectories && !publicShare) {
    for (const occurrence of template.content.querySelectorAll<HTMLElement>(
      "[data-ya-directory-file]",
    )) {
      const filePath = occurrence.dataset.yaDirectoryFile;
      if (!filePath) continue;
      const anchor =
        occurrence.closest<HTMLAnchorElement>("a") ??
        occurrence.querySelector<HTMLAnchorElement>("a") ??
        document.createElement("a");
      setProjectPathAnchorTarget(anchor, projectId, filePath, null);
      if (anchor.contains(occurrence)) {
        occurrence.textContent = filePath;
      } else {
        anchor.textContent = filePath;
        occurrence.replaceChildren(anchor);
      }
      anchor.setAttribute(
        "href",
        buildProjectFileViewerHref({
          projectId,
          filePath,
          lineNumber: Number(anchor.dataset.yaLine) || undefined,
          columnNumber: Number(anchor.dataset.yaColumn) || undefined,
        }),
      );
      directoryAnchors.add(anchor);
      changed = true;
    }
  }

  // A previous full-name match is only a fallback. Do not retarget or tokenize
  // an occurrence already resolved from this turn's directory context.
  if (targets.size === 0) return finish();
  for (const anchor of template.content.querySelectorAll<HTMLAnchorElement>(
    'a[data-ya-resource="project-file"]',
  )) {
    if (directoryAnchors.has(anchor)) continue;
    const filePath = targets.get(anchor.textContent?.trim() ?? "");
    if (!filePath) continue;
    if (setProjectPathAnchorTarget(anchor, projectId, filePath, publicShare)) {
      changed = true;
    }
  }

  const walker = document.createTreeWalker(
    template.content,
    NodeFilter.SHOW_TEXT,
  );
  const textNodes: Text[] = [];
  let node = walker.nextNode();
  while (node) {
    if (
      node instanceof Text &&
      !node.parentElement?.closest("a,button,script,style,textarea")
    ) {
      textNodes.push(node);
    }
    node = walker.nextNode();
  }

  for (const textNode of textNodes) {
    const matches = findProjectPathTokens(textNode.data).filter((token) =>
      targets.has(token.text),
    );
    for (let index = matches.length - 1; index >= 0; index -= 1) {
      const match = matches[index];
      if (!match) continue;
      const anchor = document.createElement("a");
      if (
        !setProjectPathAnchorTarget(
          anchor,
          projectId,
          targets.get(match.text)!,
          publicShare,
        )
      ) {
        continue;
      }
      const suffix = textNode.splitText(match.end);
      const matched = textNode.splitText(match.start);
      matched.replaceWith(anchor);
      anchor.append(matched);
      void suffix;
      changed = true;
    }
  }

  return finish();
}

/** Cheap pre-check: a file link with a line, or `:N` ending or after a link. */
const MAY_CITE_POSITION =
  /data-ya-line="|:\d+(?:[-:]\d+)?(?:<\/code>)?<\/a>|<\/a>:\d/;

const FILE_LINK_SELECTOR =
  'a[data-ya-resource="project-file"], a[data-ya-resource="local-file"], a[data-fixed-font-file-path]';

const LINK_POSITION_FIELDS = [
  ["data-ya-line", "line", "lineNumber"],
  ["data-ya-line-end", "lineEnd", "lineEnd"],
  ["data-ya-column", "column", "columnNumber"],
] as const;

/**
 * Split each visible `path:42` file link in two: the path opens the file and
 * `:42` opens it at that line. Both copies keep every other attribute, so
 * their context menus match and only viewing differs.
 */
function splitCitedFileLinks(root: DocumentFragment): boolean {
  let changed = false;
  for (const anchor of root.querySelectorAll<HTMLAnchorElement>(
    FILE_LINK_SELECTOR,
  )) {
    const positioned =
      splitOwnCitedPosition(anchor) ?? linkFollowingCitedPosition(anchor);
    if (!positioned) continue;
    anchor.after(positioned);
    changed = true;
  }
  return changed;
}

/**
 * `path:42` inside one anchor: move `:42` into a positioned copy. Both anchors
 * go inside any wrapper such as inline `<code>`, so it stays one pill.
 */
function splitOwnCitedPosition(
  anchor: HTMLAnchorElement,
): HTMLAnchorElement | null {
  const walker = document.createTreeWalker(anchor, NodeFilter.SHOW_TEXT);
  let text = walker.nextNode();
  while (text && !(text instanceof Text && text.data)) text = walker.nextNode();
  // Only a single text run can move inside its wrappers without losing link.
  if (!(text instanceof Text) || text.data !== anchor.textContent) return null;
  const cited = splitTrailingCitedPosition(text.data);
  if (!cited) return null;
  const { position } = cited;
  const linkedPath =
    anchor.dataset.yaPath ?? anchor.dataset.fixedFontFilePath ?? "";
  const citesLinkedLine = anchor.dataset.yaLine
    ? Number(anchor.dataset.yaLine) === position.lineNumber
    : !linkedPath.endsWith(position.text);
  if (!citesLinkedLine) return null;

  const citation = text.splitText(cited.path.length);
  anchor.replaceWith(...anchor.childNodes);
  text.replaceWith(anchor);
  anchor.append(text);
  const positioned = positionedFileLinkCopy(anchor, position);
  positioned.append(citation);
  setFileLinkPosition(anchor, null);
  return positioned;
}

/** A line-less file link followed by `:42` text: link that text at the line. */
function linkFollowingCitedPosition(
  anchor: HTMLAnchorElement,
): HTMLAnchorElement | null {
  const next = anchor.nextSibling;
  if (anchor.dataset.yaLine || !(next instanceof Text)) return null;
  const position = readLeadingCitedPosition(next.data);
  if (!position) return null;
  next.splitText(position.text.length);
  const positioned = positionedFileLinkCopy(anchor, position);
  positioned.append(next);
  return positioned;
}

function positionedFileLinkCopy(
  anchor: HTMLAnchorElement,
  position: CitedFilePosition,
): HTMLAnchorElement {
  const copy = anchor.cloneNode(false) as HTMLAnchorElement;
  setFileLinkPosition(copy, position);
  return copy;
}

/** Set or clear one link's position in both its attributes and its href. */
function setFileLinkPosition(
  anchor: HTMLAnchorElement,
  position: CitedFilePosition | null,
): void {
  const href = anchor.getAttribute("href");
  const url = href ? new URL(href, "http://localhost") : null;
  for (const [attribute, param, field] of LINK_POSITION_FIELDS) {
    const value = position?.[field];
    if (value === undefined) {
      anchor.removeAttribute(attribute);
      url?.searchParams.delete(param);
    } else {
      anchor.setAttribute(attribute, String(value));
      url?.searchParams.set(param, String(value));
    }
  }
  if (href && url) {
    anchor.setAttribute(
      "href",
      href.startsWith("/")
        ? `${url.pathname}${url.search}${url.hash}`
        : url.href,
    );
  }
}
