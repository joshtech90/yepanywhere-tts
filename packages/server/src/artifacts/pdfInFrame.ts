import { ARTIFACT_TAB_PROTOCOL } from "@yep-anywhere/shared";

function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (char) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        char
      ]!,
  );
}

/**
 * Chromium refuses its PDF viewer inside any sandboxed frame and shows "This
 * content is blocked", and every YA viewer frame is sandboxed. So a frame
 * navigation to a PDF is answered with `pdfInFrameDocument` instead; direct
 * fetches, top-level tabs and explicit downloads still receive the bytes.
 */
export function isFramePdfNavigation(
  request: Request,
  contentType: string | null | undefined,
): boolean {
  return (
    request.headers.get("sec-fetch-dest") === "iframe" &&
    new URL(request.url).searchParams.get("download") !== "true" &&
    (contentType ?? "").split(";")[0]!.trim().toLowerCase() ===
      "application/pdf"
  );
}

/**
 * Stand-in served to a sandboxed frame that navigated to a PDF. The frame may
 * not open popups, so its buttons ask the YA viewer to open this same URL in a
 * new tab; the page's own address is the fallback. `download` offers the
 * `?download=true` form, which only a server that honors it can serve.
 */
export function pdfInFrameDocument(
  name: string,
  { download = true }: { download?: boolean } = {},
): string {
  const protocol = JSON.stringify(ARTIFACT_TAB_PROTOCOL);
  const downloadButton = download
    ? '<button type="button" id="download">Download</button>'
    : "";
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHtml(name)}</title><style>body{font:15px/1.5 system-ui,sans-serif;margin:0;padding:24px;color:#222;background:#fafafa}p{margin:0 0 12px}.actions{display:flex;flex-wrap:wrap;gap:8px}button{font:inherit;padding:6px 12px}code{word-break:break-all;user-select:all}</style></head><body><p><strong>${escapeHtml(name)}</strong> is a PDF. The embedded preview cannot display PDFs, so open it in its own tab.</p><p class="actions"><button type="button" id="open">Open PDF in a new tab</button>${downloadButton}<button type="button" onclick="history.back()">Back</button></p><p>If nothing opens, copy this address into a new tab: <code id="address"></code></p><script>(function(){var url=new URL(location.href);url.hash="";url.search="";document.getElementById("address").textContent=url.href;function send(download){var target=new URL(url.href);if(download)target.searchParams.set("download","true");parent.postMessage({protocol:${protocol},type:"open",url:target.href},"*");}document.getElementById("open").onclick=function(){send(false);};var d=document.getElementById("download");if(d)d.onclick=function(){send(true);};})();</script></body></html>`;
}
