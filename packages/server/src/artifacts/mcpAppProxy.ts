import {
  MCP_APP_PROXY_SANDBOX,
  MCP_APP_VIEW_SANDBOX,
  type McpAppResourceCsp,
} from "@yep-anywhere/shared";

/**
 * The MCP Apps sandbox proxy (SEP-1865 § Sandbox proxy), served at a fixed
 * path of the isolated artifact origin. The YA page frames it; it frames the
 * view's HTML in an opaque-origin `srcdoc` child and relays JSON-RPC between
 * the two. The view's CSP is this response's header, which the `srcdoc` child
 * inherits, so a view cannot loosen it. See topics/mcp-apps.md.
 */

const DOMAIN_PATTERN =
  /^(?:https?|wss?):\/\/(?:\*\.)?[A-Za-z0-9.-]+(?::\d{1,5})?$/;
const MAX_DOMAINS = 32;

/** Keep only plain origins: anything else could inject a CSP keyword. */
function domains(list: unknown): string[] {
  if (!Array.isArray(list)) return [];
  return list
    .filter(
      (entry): entry is string =>
        typeof entry === "string" && DOMAIN_PATTERN.test(entry),
    )
    .slice(0, MAX_DOMAINS);
}

/** Parse the `csp` query parameter; malformed input means no declared domains. */
export function parseMcpAppCspParam(
  raw: string | undefined,
): McpAppResourceCsp {
  if (!raw) return {};
  try {
    const value = JSON.parse(raw) as Record<string, unknown>;
    return {
      connectDomains: domains(value.connectDomains),
      resourceDomains: domains(value.resourceDomains),
      frameDomains: domains(value.frameDomains),
      baseUriDomains: domains(value.baseUriDomains),
    };
  } catch {
    return {};
  }
}

/**
 * The spec's restrictive default, widened only by the origins the view's
 * resource declared. Nothing here depends on the view's HTML.
 */
export function mcpAppViewCsp(csp: McpAppResourceCsp): string {
  const resource = domains(csp.resourceDomains);
  const connect = domains(csp.connectDomains);
  const frame = domains(csp.frameDomains);
  const base = domains(csp.baseUriDomains);
  const withSources = (directive: string, fixed: string, extra: string[]) =>
    [directive, fixed, ...extra].filter(Boolean).join(" ");
  return [
    `sandbox ${MCP_APP_PROXY_SANDBOX}`,
    "default-src 'none'",
    withSources("script-src", "'self' 'unsafe-inline'", resource),
    withSources("style-src", "'self' 'unsafe-inline'", resource),
    withSources("img-src", "'self' data: blob:", resource),
    withSources("font-src", "'self' data:", resource),
    withSources("media-src", "'self' data: blob:", resource),
    connect.length > 0
      ? `connect-src ${connect.join(" ")}`
      : "connect-src 'none'",
    frame.length > 0 ? `frame-src ${frame.join(" ")}` : "frame-src 'none'",
    "object-src 'none'",
    base.length > 0 ? `base-uri ${base.join(" ")}` : "base-uri 'self'",
    "form-action 'none'",
  ].join("; ");
}

const PROXY_SCRIPT = `(function () {
  var host = new URLSearchParams(location.search).get("host");
  var valid = false;
  try {
    var parsed = new URL(host || "");
    valid = (parsed.protocol === "http:" || parsed.protocol === "https:") && parsed.origin === host;
  } catch (error) {}
  if (window.top === window.self || !valid) {
    document.body.textContent = "This page only runs inside a Yep Anywhere session.";
    return;
  }
  var inner = document.createElement("iframe");
  inner.setAttribute("sandbox", ${JSON.stringify(MCP_APP_VIEW_SANDBOX)});
  inner.setAttribute("referrerpolicy", "no-referrer");
  inner.title = "MCP App view";
  document.body.appendChild(inner);
  var loaded = false;
  window.addEventListener("message", function (event) {
    var data = event.data;
    if (event.source === window.parent) {
      if (event.origin !== host) return;
      if (data && data.method === "ui/notifications/sandbox-resource-ready") {
        if (loaded || !data.params || typeof data.params.html !== "string") return;
        loaded = true;
        inner.srcdoc = data.params.html;
        return;
      }
      if (inner.contentWindow) inner.contentWindow.postMessage(data, "*");
    } else if (event.source === inner.contentWindow) {
      if (data && typeof data.method === "string" && data.method.indexOf("ui/notifications/sandbox-") === 0) return;
      window.parent.postMessage(data, host);
    }
  });
  window.parent.postMessage({ jsonrpc: "2.0", method: "ui/notifications/sandbox-proxy-ready", params: {} }, host);
})();`;

export const MCP_APP_PROXY_DOCUMENT = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="color-scheme" content="light dark"><title>MCP App view</title><style>html,body{margin:0;height:100%;background:transparent}body{display:flex}iframe{flex:1;border:0;width:100%;height:100%;background:transparent;color-scheme:inherit}</style></head><body><script>${PROXY_SCRIPT}</script></body></html>`;
