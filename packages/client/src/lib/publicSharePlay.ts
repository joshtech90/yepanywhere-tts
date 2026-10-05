/**
 * Play for public share viewers: the shared HTML with its directly referenced
 * stylesheets, scripts, images, and media inlined as data URLs, so a
 * sandboxed opaque-origin frame can run it with no network reach back to the
 * share. Which references count, and the file each names, is the shared
 * `findHtmlRootAssetReferences` decision the server authorizes by; a file
 * the share nonetheless does not serve stays as written and fails to load
 * inside the sandbox.
 *
 * The play document is the hosted static `play.html`, addressed by a plain
 * URL that carries the same share grant as the file link: relay coordinates
 * in the query and the secret in the fragment, which never reaches a static
 * host's access log. That makes a play link copyable and shareable as-is.
 */
import {
  DEFAULT_RELAY_URL,
  findHtmlRootAssetReferences,
  fromUrlProjectId,
  isUrlProjectId,
  normalizeRelayUrl,
  resolveLinkedReference,
} from "@yep-anywhere/shared";

const MAX_INLINED_BYTES = 48 * 1024 * 1024;

export interface PublicSharePlayTarget {
  relayUsername: string;
  /** Omitted or default relay adds no `r` parameter, as share links do. */
  relayUrl?: string;
  secret: string;
  projectId: string;
  path: string;
}

/** `play.html` beneath the hosted client's base, carrying the share grant. */
export function buildPublicSharePlayUrl(
  basePath: string,
  target: PublicSharePlayTarget,
): string {
  const params = new URLSearchParams({
    h: target.relayUsername,
    projectId: target.projectId,
    path: target.path,
  });
  if (target.relayUrl) {
    const relayUrl = normalizeRelayUrl(target.relayUrl);
    if (relayUrl !== DEFAULT_RELAY_URL) params.set("r", relayUrl);
  }
  const hash = new URLSearchParams({ share: target.secret });
  return `${basePath}/play.html?${params}#${hash}`;
}

/** Read the target back out of a play URL; null when it is not one. */
export function parsePublicSharePlayUrl(
  href: string,
): PublicSharePlayTarget | null {
  let url: URL;
  try {
    url = new URL(href, "http://play.local");
  } catch {
    return null;
  }
  const secret = new URLSearchParams(url.hash.slice(1)).get("share");
  const relayUsername = url.searchParams.get("h");
  const projectId = url.searchParams.get("projectId");
  const path = url.searchParams.get("path");
  if (!secret || !relayUsername || !projectId || !path) return null;
  const relayUrl = url.searchParams.get("r") ?? undefined;
  return {
    secret,
    relayUsername,
    projectId,
    path,
    ...(relayUrl ? { relayUrl } : {}),
  };
}

/**
 * The play counterpart of a public file share link, or null when the link is
 * not a file share. Keeps the link's origin and its `/remote` prefix.
 */
export function publicSharePlayUrlFromFileShareUrl(
  shareUrl: string,
): string | null {
  let url: URL;
  try {
    url = new URL(shareUrl);
  } catch {
    return null;
  }
  const match = /^(\/remote)?\/share\/([A-Za-z0-9_-]+)\/file$/.exec(
    url.pathname,
  );
  const relayUsername = url.searchParams.get("h");
  const projectId = url.searchParams.get("projectId");
  const path = url.searchParams.get("path");
  if (!match || !relayUsername || !projectId || !path) return null;
  const relayUrl = url.searchParams.get("r") ?? undefined;
  return `${url.origin}${buildPublicSharePlayUrl(match[1] ?? "", {
    relayUsername,
    projectId,
    path,
    secret: match[2]!,
    ...(relayUrl ? { relayUrl } : {}),
  })}`;
}

/** The message a play frame posts when a reader follows a link out of it. */
export const PLAY_LINK_MESSAGE = "ya-play-link";

/**
 * Links in the play frame, resolved at click time because pages also create
 * links at runtime, which a static rewrite would miss. A srcdoc document
 * resolves URLs against the embedding play page, so a `#section` link would
 * navigate the frame to `play.html` without its share grant instead of
 * scrolling; it is resolved on the frame's own `about:srcdoc` location. Any
 * other relative link names a file beside the shared one, which the share
 * serves when the root links to it. The frame never holds the grant, so it
 * posts the link to the play page, which opens that file through the share.
 * It listens on the window, after every page handler, and yields to one that
 * already took the click.
 */
export const PLAY_FRAME_LINKS_SCRIPT = `window.addEventListener("click",function(e){if(e.defaultPrevented||!(e.target instanceof Element))return;var a=e.target.closest("a[href],area[href]");if(!a)return;var h=a.getAttribute("href").trim();if(!h)return;if(h.charAt(0)==="#"){e.preventDefault();location.hash=h;return;}if(h.slice(0,2)==="//"||/^[a-z][a-z0-9+.-]*:/i.test(h))return;e.preventDefault();parent.postMessage({protocol:${JSON.stringify(PLAY_LINK_MESSAGE)},href:h},"*");});`;

/**
 * The share path a play document's relative link names, as the share's link
 * walk names what it authorizes: project-relative inside the share's project,
 * absolute outside it. Null for a link that names no file.
 */
export function playLinkSharePath(
  projectId: string,
  documentPath: string,
  href: string,
): string | null {
  const root = projectRootPath(projectId);
  const document = absolutePublicSharePath(projectId, documentPath);
  if (!root || !document) return null;
  const target = resolveLinkedReference(
    document,
    document.slice(0, document.lastIndexOf("/") + 1),
    href,
  );
  if (!target) return null;
  return target.startsWith(`${root}/`) ? target.slice(root.length + 1) : target;
}

/**
 * A share path — project-relative, or absolute outside the project — as an
 * absolute `/`-separated path. Null for an unusable project id.
 */
export function absolutePublicSharePath(
  projectId: string,
  sharePath: string,
): string | null {
  if (/^(?:[A-Za-z]:)?\//.test(sharePath)) return sharePath;
  const root = projectRootPath(projectId);
  return root ? `${root}/${sharePath}` : null;
}

function projectRootPath(projectId: string): string | null {
  return isUrlProjectId(projectId)
    ? fromUrlProjectId(projectId).replaceAll("\\", "/").replace(/\/+$/, "")
    : null;
}

/**
 * The public file share link for another file of the same share: the share
 * viewer page, beneath the hosted client's base, as the server mints it.
 */
export function buildPublicShareFileUrl(
  basePath: string,
  target: PublicSharePlayTarget,
): string {
  const params = new URLSearchParams({
    h: target.relayUsername,
    projectId: target.projectId,
    path: target.path,
    standalone: "1",
  });
  if (target.relayUrl) {
    const relayUrl = normalizeRelayUrl(target.relayUrl);
    if (relayUrl !== DEFAULT_RELAY_URL) params.set("r", relayUrl);
  }
  return `${basePath}/share/${encodeURIComponent(target.secret)}/file?${params}#v=2&target=file`;
}

function toDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error);
    reader.onload = () => resolve(String(reader.result));
    reader.readAsDataURL(blob);
  });
}

/**
 * The shared HTML with what its elements load inlined. Each asset path takes
 * `rootPath`'s form, project-relative or absolute (`resolveHtmlRootAssetPath`).
 */
export async function buildPlayableHtml(
  html: string,
  rootPath: string,
  fetchAsset: (assetPath: string) => Promise<Blob>,
): Promise<string> {
  const references = findHtmlRootAssetReferences(html, rootPath);
  let inlined = 0;
  const dataUrls = new Map<string, Promise<string | null>>();
  for (const { path } of references) {
    if (dataUrls.has(path)) continue;
    dataUrls.set(
      path,
      fetchAsset(path)
        .then(async (blob) => {
          if (inlined + blob.size > MAX_INLINED_BYTES) return null;
          inlined += blob.size;
          return await toDataUrl(blob);
        })
        .catch(() => null),
    );
  }
  // Replace each reference's attribute value where it was written, so the
  // document inlines exactly the references the share authorized.
  let spliced = "";
  let cursor = 0;
  for (const reference of references) {
    const dataUrl = await dataUrls.get(reference.path);
    if (!dataUrl) continue;
    spliced += html.slice(cursor, reference.start);
    spliced += reference.quoted ? dataUrl : `"${dataUrl}"`;
    cursor = reference.end;
  }
  spliced += html.slice(cursor);

  const doc = new DOMParser().parseFromString(spliced, "text/html");
  for (const base of doc.querySelectorAll("base")) base.remove();
  const links = doc.createElement("script");
  links.textContent = PLAY_FRAME_LINKS_SCRIPT;
  doc.head.prepend(links);
  return `<!doctype html>${doc.documentElement.outerHTML}`;
}
