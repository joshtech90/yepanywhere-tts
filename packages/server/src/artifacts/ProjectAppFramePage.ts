import { createHash } from "node:crypto";
import { html, raw } from "hono/html";

const stylesheet =
  "html,body{margin:0;height:100%;overflow:hidden;background:#fff}iframe{display:block;width:100%;height:100%;border:0}";
const styleHash = createHash("sha256").update(stylesheet).digest("base64");

/**
 * The frame source for a static app request: the grant's entry for `/`, or
 * the same relative path under the grant's root for a deep link. Paths with
 * dot segments fall back to the entry so a crafted address cannot name a
 * different grant on the artifact origin.
 */
export function staticAppFrameSource(
  grantUrl: string,
  pathname: string,
): string {
  const segments = pathname.split("/").filter(Boolean);
  if (
    segments.length === 0 ||
    segments.some((segment) => segment === "." || segment === "..")
  )
    return grantUrl;
  return new URL(segments.join("/"), new URL(".", grantUrl)).toString();
}

/**
 * Serve a static project app at its reserved address without replacing the
 * address: a full-viewport frame around the contained artifact grant. The
 * page itself runs no script and loads nothing but the framed grant.
 */
export function projectAppFramePage(options: {
  src: string;
  cookie?: string;
}): Response {
  const frameOrigin = new URL(options.src).origin;
  const document = html`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="referrer" content="no-referrer"><title>Project app</title><style>${raw(stylesheet)}</style></head><body><iframe src="${options.src}" title="Project app" allow="fullscreen; clipboard-read; clipboard-write"></iframe></body></html>`;
  return new Response(document.toString(), {
    status: 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      "Referrer-Policy": "no-referrer",
      "Content-Security-Policy": `default-src 'none'; style-src 'sha256-${styleHash}'; frame-src ${frameOrigin}; base-uri 'none'; form-action 'none'`,
      "X-Content-Type-Options": "nosniff",
      ...(options.cookie ? { "Set-Cookie": options.cookie } : {}),
    },
  });
}
