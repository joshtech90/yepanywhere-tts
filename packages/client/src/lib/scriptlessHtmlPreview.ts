import { resolveLinkedReference } from "@yep-anywhere/shared";

const SCRIPTLESS_PREVIEW_CSP = [
  "default-src 'none'",
  "script-src 'none'",
  "connect-src 'none'",
  "object-src 'none'",
  "frame-src 'none'",
  "worker-src 'none'",
  "form-action 'none'",
  "base-uri 'none'",
  "img-src data: blob:",
  "media-src data: blob:",
  "style-src 'unsafe-inline'",
].join("; ");

/**
 * Put untrusted HTML after a client-owned CSP so iframe srcdoc previews cannot
 * inherit network or application authority from the trusted YA document.
 * The iframe's sandbox must still withhold scripts; it grants only
 * `allow-same-origin`, so the viewer can search the preview
 * (SCRIPTLESS_PREVIEW_SANDBOX in ArtifactPreview.tsx).
 */
export function createScriptlessHtmlPreviewDocument(
  html: string,
  /** The previewed file's absolute path; its relative links resolve here. */
  documentPath?: string | null,
): string {
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${SCRIPTLESS_PREVIEW_CSP}"><meta name="referrer" content="no-referrer"></head><body>${resolveLinksForSrcdoc(html, documentPath ?? null)}</body></html>`;
}

/**
 * A srcdoc document resolves URLs against the embedding YA page, so a
 * `#section` link would navigate the frame to the YA route instead of
 * scrolling, and `notes.pdf` would load `/…/sessions/notes.pdf`, a YA route
 * the scriptless frame shows blank. A `<base>` cannot fix either: the frame
 * inherits the app's `base-uri` policy, which refuses `about:srcdoc` and any
 * file location. Addressing the fragment on `about:srcdoc` itself keeps it a
 * same-document scroll. A relative link names a file beside the previewed
 * one, resolved as a linked-site walk resolves it; it becomes a local-file
 * resource link, which the owning viewer opens (ArtifactPreview's
 * `onLocalResourceLink`). Root-relative links name no file for a lone
 * document and are left alone.
 */
function resolveLinksForSrcdoc(
  html: string,
  documentPath: string | null,
): string {
  const hasFragmentLink = /href\s*=\s*["']?\s*#/i.test(html);
  if (!hasFragmentLink && !(documentPath && /href\s*=/i.test(html)))
    return html;
  // DOMParser builds an inert document: nothing runs or loads.
  const parsed = new DOMParser().parseFromString(html, "text/html");
  for (const anchor of parsed.querySelectorAll("a[href], area[href]")) {
    const href = anchor.getAttribute("href")!.trim();
    if (href.startsWith("#")) {
      anchor.setAttribute("href", `about:srcdoc${href}`);
      continue;
    }
    if (!documentPath || href.startsWith("/")) continue;
    const target = resolveLinkedReference(documentPath, documentPath, href);
    if (!target) continue;
    anchor.setAttribute(
      "href",
      `/api/local-file?${new URLSearchParams({ path: target })}`,
    );
    anchor.setAttribute("data-ya-resource", "local-file");
    anchor.setAttribute("data-ya-path", target);
  }
  return parsed.documentElement.outerHTML;
}
