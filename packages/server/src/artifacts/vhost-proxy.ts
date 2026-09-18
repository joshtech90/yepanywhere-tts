import { request as httpRequest } from "node:http";
import { Readable } from "node:stream";

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

function outgoingHeaders(request: Request): Record<string, string | string[]> {
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
  headers["x-forwarded-proto"] = new URL(request.url).protocol.replace(":", "");
  headers["x-forwarded-for"] = "127.0.0.1";
  return headers;
}

/** Reverse-proxy `request` to loopback `port`, preserving the incoming Host. */
export function proxyLoopbackVhost(
  incoming: Request,
  port: number,
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
        headers: outgoingHeaders(incoming),
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
