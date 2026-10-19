// The network serves this fixed script; artifact bytes only come from a live broker.
const POLICY = [
  "sandbox allow-scripts allow-same-origin",
  "default-src 'none'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "frame-src 'none'",
  "worker-src 'none'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'none'",
].join("; ");
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) =>
  event.waitUntil(self.clients.claim()),
);
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin || !url.pathname.startsWith("/v/"))
    return;
  event.respondWith(deliver(event.request, url));
});

async function deliver(request, url) {
  if (request.method !== "GET")
    return new Response("Read only", { status: 405 });
  const [, , viewerId, ...parts] = url.pathname.split("/");
  const path = parts.map(decodeURIComponent).join("/");
  if (
    !viewerId ||
    !path ||
    path.split("/").some((part) => !part || part.startsWith("."))
  )
    return new Response("Invalid file path", { status: 403 });
  // No in-memory registration map: a stopped worker rediscovers the owner.
  const windows = await self.clients.matchAll({
    type: "window",
    includeUncontrolled: true,
  });
  const broker = windows.find((client) => {
    const candidate = new URL(client.url);
    return (
      candidate.origin === url.origin &&
      candidate.pathname === "/__ya/bootstrap.html" &&
      candidate.searchParams.get("viewer") === viewerId
    );
  });
  if (!broker) return new Response("No live viewer", { status: 503 });
  const { port1, port2 } = new MessageChannel();
  let timer;
  const head = await new Promise((resolve) => {
    timer = setTimeout(
      () => resolve({ status: 504, error: "Viewer did not answer" }),
      10000,
    );
    port1.onmessage = (event) => {
      clearTimeout(timer);
      resolve(event.data);
    };
    broker.postMessage({ type: "read", viewerId, path }, [port2]);
  });
  if (head.error || head.status !== 200) {
    port1.close();
    return new Response(head.error ?? "Read refused", {
      status: head.status ?? 502,
    });
  }
  const body = new ReadableStream(
    {
      pull(controller) {
        return new Promise((resolve) => {
          timer = setTimeout(() => {
            controller.error(new Error("Body timed out"));
            port1.close();
            resolve();
          }, 10000);
          port1.onmessage = (event) => {
            clearTimeout(timer);
            if (event.data.type === "chunk")
              controller.enqueue(new Uint8Array(event.data.bytes));
            else if (event.data.type === "end") {
              controller.close();
              port1.close();
            } else {
              controller.error(new Error(event.data.error ?? "Read failed"));
              port1.close();
            }
            resolve();
          };
          port1.postMessage({ type: "pull" });
        });
      },
      cancel() {
        clearTimeout(timer);
        port1.postMessage({ type: "cancel" });
        port1.close();
      },
    },
    { highWaterMark: 0 },
  );
  return new Response(body, {
    headers: {
      "content-type": head.mime,
      "cache-control": "no-store",
      "content-security-policy": POLICY,
      "origin-agent-cluster": "?1",
      "x-content-type-options": "nosniff",
      "referrer-policy": "no-referrer",
      "x-ya-spike-worker": "1",
    },
  });
}
