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
  "font-src data: blob:",
  "style-src 'unsafe-inline'",
].join("; ");

/**
 * Put a client-owned CSP ahead of untrusted HTML so iframe srcdoc previews
 * cannot inherit network or application authority from the trusted YA
 * document. The iframe's sandbox must still withhold scripts; it grants only
 * `allow-same-origin`, so the viewer can search the preview
 * (SCRIPTLESS_PREVIEW_SANDBOX in ArtifactPreview.tsx).
 *
 * The policy goes first in the file's own head, so the file keeps its
 * `<html>`/`<body>` attributes and head order. DOMParser builds an inert
 * document: nothing runs or loads while the wrapper rewrites it.
 */
export function createScriptlessHtmlPreviewDocument(
  html: string,
  /** The previewed file's absolute path; its relative links resolve here. */
  documentPath?: string | null,
): string {
  const parsed = new DOMParser().parseFromString(html, "text/html");
  inlineDataStylesheets(parsed);
  resolveLinksForSrcdoc(parsed, documentPath ?? null);
  const policy = parsed.createElement("meta");
  policy.setAttribute("http-equiv", "Content-Security-Policy");
  policy.setAttribute("content", SCRIPTLESS_PREVIEW_CSP);
  const referrer = parsed.createElement("meta");
  referrer.setAttribute("name", "referrer");
  referrer.setAttribute("content", "no-referrer");
  const charset = parsed.createElement("meta");
  charset.setAttribute("charset", "utf-8");
  parsed.head.prepend(charset, policy, referrer);
  return `<!doctype html>${parsed.documentElement.outerHTML}`;
}

/**
 * Self-contained exports (Quarto/Pandoc `embed-resources`) carry their
 * stylesheets as `<link rel="stylesheet" href="data:text/css,...">`. A srcdoc
 * frame inherits the YA app's `style-src 'self' 'unsafe-inline'`, which
 * refuses data: stylesheets, so the page rendered unstyled. The same CSS as an
 * inline `<style>` is admitted by both policies and grants nothing an inline
 * style in the file could not already do. A link that is not a decodable
 * data: CSS URL is left as written, for the policy to refuse.
 */
function inlineDataStylesheets(parsed: Document): void {
  for (const link of parsed.querySelectorAll("link[rel][href]")) {
    const rel = link.getAttribute("rel")!.toLowerCase().split(/\s+/);
    if (!rel.includes("stylesheet") || rel.includes("alternate")) continue;
    const css = decodeCssDataUrl(link.getAttribute("href")!.trim());
    if (css === null) continue;
    const style = parsed.createElement("style");
    const media = link.getAttribute("media");
    if (media) style.setAttribute("media", media);
    // Serialization writes style text raw; keep it from closing the element.
    style.textContent = css.replace(/<\/(style)/gi, "<\\/$1");
    link.replaceWith(style);
  }
}

function decodeCssDataUrl(href: string): string | null {
  const match = /^data:([^,]*),(.*)$/is.exec(href);
  if (!match) return null;
  const params = match[1]!.split(";").map((part) => part.trim().toLowerCase());
  const mimeType = params[0] ?? "";
  if (mimeType !== "" && mimeType !== "text/css") return null;
  const payload = match[2]!;
  try {
    const bytes = params.includes("base64")
      ? Uint8Array.from(atob(payload), (character) => character.charCodeAt(0))
      : new TextEncoder().encode(decodeURIComponent(payload));
    return new TextDecoder().decode(bytes);
  } catch {
    // Malformed percent or base64 encoding: leave the link for CSP to refuse.
    return null;
  }
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
  parsed: Document,
  documentPath: string | null,
): void {
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
}
