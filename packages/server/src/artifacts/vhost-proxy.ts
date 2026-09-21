import { request as httpRequest } from "node:http";
import { Readable } from "node:stream";
import { vhostExternalProtocol } from "./vhosts.js";

const HOP_BY_HOP = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailers",
  "transfer-encoding",
  "upgrade",
  "http2-settings",
]);

function outgoingHeaders(
  request: Request,
  clientAddress: string | undefined,
): Record<string, string | string[]> {
  const headers: Record<string, string | string[]> = {};
  request.headers.forEach((value, key) => {
    if (HOP_BY_HOP.has(key.toLowerCase())) return;
    const existing = headers[key];
    headers[key] = existing
      ? Array.isArray(existing)
        ? [...existing, value]
        : [existing, value]
      : value;
  });
  const host = request.headers.get("host");
  if (host) headers.host = host;
  headers["x-forwarded-host"] = host ?? "";
  headers["x-forwarded-proto"] = vhostExternalProtocol(
    new URL(request.url).hostname,
  );
  // The app is behind however many proxies actually carried the request: the
  // operator's tunnel names the visitor, and YA appends the peer it answered.
  // An unknown peer adds no hop rather than claiming loopback, so an address
  // in this chain is always one a proxy on the path really saw.
  const chain = [request.headers.get("x-forwarded-for"), clientAddress]
    .filter(Boolean)
    .join(", ");
  if (chain) headers["x-forwarded-for"] = chain;
  else delete headers["x-forwarded-for"];
  return headers;
}

/**
 * Reverse-proxy `request` to loopback `port`, preserving the incoming Host.
 * `clientAddress` is the peer YA answered, which the upstream sees as the last
 * forwarded-for hop.
 */
export function proxyLoopbackVhost(
  incoming: Request,
  port: number,
  clientAddress?: string,
): Promise<Response> {
  if (incoming.headers.get("upgrade"))
    return Promise.resolve(
      new Response("WebSocket vhost proxy is not available", { status: 501 }),
    );
  const url = new URL(incoming.url);
  return new Promise((resolve) => {
    const req = httpRequest(
      {
        hostname: "127.0.0.1",
        port,
        path: `${url.pathname}${url.search}`,
        method: incoming.method,
        headers: outgoingHeaders(incoming, clientAddress),
      },
      (res) => {
        const headers = new Headers();
        for (const [key, value] of Object.entries(res.headers)) {
          if (!value || HOP_BY_HOP.has(key.toLowerCase())) continue;
          if (Array.isArray(value))
            for (const item of value) headers.append(key, item);
          else headers.set(key, value);
        }
        resolve(
          new Response(Readable.toWeb(res) as ReadableStream, {
            status: res.statusCode ?? 502,
            statusText: res.statusMessage,
            headers,
          }),
        );
      },
    );
    req.on("error", () => {
      resolve(new Response("Vhost upstream unreachable", { status: 502 }));
    });
    if (incoming.method === "GET" || incoming.method === "HEAD") {
      req.end();
      return;
    }
    if (!incoming.body) {
      req.end();
      return;
    }
    Readable.fromWeb(
      incoming.body as import("node:stream/web").ReadableStream,
    ).pipe(req);
  });
}
