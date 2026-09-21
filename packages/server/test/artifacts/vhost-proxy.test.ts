import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, expect, it } from "vitest";
import { proxyLoopbackVhost } from "../../src/artifacts/vhost-proxy.js";

let upstream: Server;
let port: number;

beforeAll(async () => {
  upstream = createServer((request, response) => {
    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify(request.headers));
  });
  await new Promise<void>((resolve) =>
    upstream.listen(0, "127.0.0.1", () => resolve()),
  );
  port = (upstream.address() as AddressInfo).port;
});

afterAll(async () => {
  upstream.closeAllConnections();
  await new Promise<void>((resolve, reject) =>
    upstream.close((error) => (error ? reject(error) : resolve())),
  );
});

async function forwarded(url: string, init?: RequestInit, peer?: string) {
  // A served request carries the visitor's Host, which is what the vhost
  // listener matched on and what the app is told it was addressed as.
  const request = new Request(url, {
    ...init,
    headers: { host: new URL(url).host, ...init?.headers },
  });
  const response = await proxyLoopbackVhost(request, port, peer);
  return (await response.json()) as Record<string, string>;
}

it("tells the app it was reached over the tunnel's HTTPS, not the listener's HTTP", async () => {
  const headers = await forwarded("http://plan.example.org/review");
  expect(headers["x-forwarded-proto"]).toBe("https");
  expect(headers["x-forwarded-host"]).toBe("plan.example.org");
});

it("keeps a local vhost visit plain HTTP", async () => {
  const headers = await forwarded("http://plan.localhost:4402/review");
  expect(headers["x-forwarded-proto"]).toBe("http");
});

it("appends the peer YA answered to the visitor the tunnel named", async () => {
  const headers = await forwarded(
    "http://plan.example.org/review",
    { headers: { "x-forwarded-for": "198.51.100.7" } },
    "127.0.0.1",
  );
  expect(headers["x-forwarded-for"]).toBe("198.51.100.7, 127.0.0.1");
});

it("reports a LAN visitor's own address rather than loopback", async () => {
  const headers = await forwarded(
    "http://plan.localhost:4402/review",
    undefined,
    "192.168.1.40",
  );
  expect(headers["x-forwarded-for"]).toBe("192.168.1.40");
});

it("claims no hop when the peer is unknown", async () => {
  const headers = await forwarded("http://plan.localhost:4402/review");
  expect(headers["x-forwarded-for"]).toBeUndefined();
});
