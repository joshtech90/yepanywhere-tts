/**
 * Entry for play.html: full-window host for a public share's play document.
 *
 * The URL carries the share grant exactly as a file share link does. This
 * page fetches the shared HTML and its directly referenced assets through
 * the share's own relay routes, inlines the assets, and runs the result only
 * inside the sandboxed frame below, which lacks allow-same-origin and so has
 * an opaque origin. The page holds nothing but the document text.
 */
import {
  DEFAULT_RELAY_URL,
  type FileContentResponse,
  linkedDocumentKind,
  normalizeRelayUrl,
} from "@yep-anywhere/shared";
import enMessages from "./i18n/en.json";
import {
  buildPublicShareFileRoutePath,
  fetchPublicShareRawFileBlob,
} from "./lib/publicShareFiles";
import {
  absolutePublicSharePath,
  buildPlayableHtml,
  buildPublicShareFileUrl,
  buildPublicSharePlayUrl,
  PLAY_LINK_MESSAGE,
  parsePublicSharePlayUrl,
  playLinkSharePath,
} from "./lib/publicSharePlay";
import { fetchPublicShareJsonViaRelay } from "./lib/publicShareRelay";

/**
 * `allow-forms` lets the document's scripted forms receive their submit
 * event; play.html's `form-action 'none'` still refuses every form navigation.
 */
export const PLAY_FRAME_SANDBOX =
  "allow-scripts allow-popups allow-downloads allow-forms allow-modals";

const notice = document.getElementById("notice") as HTMLParagraphElement;

/**
 * A srcdoc document's fallback base URL is this page's base URL, which by
 * default is the page URL with the share secret in its fragment. Give the
 * page a base without the fragment before the document exists.
 */
function dropFragmentFromBaseUrl(): void {
  const url = new URL(window.location.href);
  url.hash = "";
  const base = document.createElement("base");
  base.href = url.href;
  document.head.prepend(base);
}

async function main(): Promise<void> {
  const target = parsePublicSharePlayUrl(window.location.href);
  if (!target) {
    notice.textContent = enMessages.publicSharePlayInvalid;
    return;
  }
  dropFragmentFromBaseUrl();
  notice.textContent = enMessages.publicSharePlayWaiting;
  const grant = {
    relayUrl: normalizeRelayUrl(target.relayUrl ?? DEFAULT_RELAY_URL),
    relayUsername: target.relayUsername,
    secret: target.secret,
    projectId: target.projectId,
    // Play is only ever for a live file share.
    standaloneFile: true,
  };
  const root = await fetchPublicShareJsonViaRelay<FileContentResponse>({
    relayUrl: grant.relayUrl,
    relayUsername: grant.relayUsername,
    path: buildPublicShareFileRoutePath(grant, "content", target.path),
  });
  if (typeof root.content !== "string")
    throw new Error(enMessages.publicSharePlayNoContent);
  // Assets resolve from the root's absolute path, so a reference above the
  // project reaches what the share's link walk authorizes there.
  const html = await buildPlayableHtml(
    root.content,
    absolutePublicSharePath(target.projectId, target.path) ?? target.path,
    (path) => fetchPublicShareRawFileBlob(grant, root, path),
  );
  const title = target.path.split("/").at(-1) ?? target.path;
  document.title = title;
  const frame = document.createElement("iframe");
  frame.setAttribute("sandbox", PLAY_FRAME_SANDBOX);
  frame.referrerPolicy = "no-referrer";
  frame.title = title;
  frame.srcdoc = html;
  notice.remove();
  document.body.append(frame);
  // A link the frame posts opens that file through the same share: HTML in
  // play, anything else in the share's file viewer. The share decides
  // whether the root links to it.
  const basePath = window.location.pathname.replace(/\/play\.html$/, "");
  window.addEventListener("message", (event) => {
    const data = event.data as { protocol?: unknown; href?: unknown } | null;
    if (
      event.source !== frame.contentWindow ||
      data?.protocol !== PLAY_LINK_MESSAGE ||
      typeof data.href !== "string"
    )
      return;
    const path = playLinkSharePath(target.projectId, target.path, data.href);
    if (!path) return;
    const next = { ...target, path };
    window.location.assign(
      linkedDocumentKind(path) === "html"
        ? buildPublicSharePlayUrl(basePath, next)
        : buildPublicShareFileUrl(basePath, next),
    );
  });
}

main().catch((error: unknown) => {
  notice.textContent = `${enMessages.publicSharePlayFailed} ${
    error instanceof Error ? error.message : String(error)
  }`;
});
