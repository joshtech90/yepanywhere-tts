import { SecureConnection } from "../../packages/client/src/lib/connection/SecureConnection";
import { openRelayClientSocket } from "../../packages/client/src/lib/connection/RelayClientSocket";

const config = JSON.parse(document.querySelector("#config")!.textContent!);
const events: unknown[] = [];
const viewers = new Map<
  string,
  { frame: HTMLIFrameElement; close(): Promise<void> }
>();
const allowed = new Set<string>(config.files);
let connection: SecureConnection | undefined;
const status = document.querySelector("#status")!;
const globalForTest = window as unknown as Record<string, unknown>;
globalForTest.evidence = events;
localStorage.setItem("ya-test-secret", "parent-only");

async function read(path: string, signal: AbortSignal): Promise<Response> {
  if (!allowed.has(path) || path.length > 1024)
    return new Response("Outside file grant", { status: 403 });
  events.push({ type: "read", path });
  if (connection) {
    const query = new URLSearchParams({ path: `${config.project}/${path}` });
    return connection.fetchStream(
      `/projects/${config.projectId}/files/raw?${query}`,
      { signal },
    );
  }
  return fetch(`/fixture/${path}`, { signal, credentials: "omit" });
}

async function openViewer(contentOrigin = config.contentOrigin) {
  if (viewers.size >= 8) throw new Error("Viewer limit");
  const viewerId = crypto.randomUUID();
  const frame = document.createElement("iframe");
  frame.title = "Service worker artifact viewer";
  frame.sandbox = "allow-scripts allow-same-origin";
  const channel = new MessageChannel();
  const controller = new AbortController();
  const readers = new Set<ReadableStreamDefaultReader<Uint8Array>>();
  let closed = false;
  let fileCount = 0;
  let totalBytes = 0;
  let pending = 0;
  const distinct = new Set<string>();
  let resolveClosed: (() => void) | undefined;
  channel.port1.onmessage = async (event) => {
    const message = event.data;
    const port = event.ports[0];
    if (message.type === "closed") {
      resolveClosed?.();
      return;
    }
    if (message.type !== "read") {
      events.push({ viewerId, ...message });
      status.textContent =
        message.type === "registered"
          ? "Viewer ready"
          : (message.error ?? message.type);
      return;
    }
    if (!port || closed) {
      port?.close();
      return;
    }
    if (
      message.viewerId !== viewerId ||
      typeof message.path !== "string" ||
      !allowed.has(message.path) ||
      pending >= 8 ||
      readers.size >= 8
    ) {
      port.postMessage({ status: 403, error: "Outside file grant" });
      port.close();
      return;
    }
    distinct.add(message.path);
    if (distinct.size > 64) {
      port.postMessage({ status: 429, error: "File limit" });
      port.close();
      return;
    }
    pending++;
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    try {
      const response = await read(message.path, controller.signal);
      if (!response.ok || !response.body) {
        port.postMessage({ status: response.status, error: "Read refused" });
        port.close();
        return;
      }
      if (closed) {
        await response.body.cancel();
        port.close();
        return;
      }
      reader = response.body.getReader();
      readers.add(reader);
      fileCount++;
      port.postMessage({
        status: 200,
        mime:
          response.headers.get("content-type") ?? "application/octet-stream",
      });
      const owned = reader;
      let bytes = 0;
      port.onmessage = async (event) => {
        if (event.data.type === "cancel") {
          await owned.cancel();
          readers.delete(owned);
          events.push({ type: "stream-cancelled", path: message.path, bytes });
          port.close();
          return;
        }
        if (event.data.type !== "pull") return;
        try {
          const part = await owned.read();
          if (part.done) {
            readers.delete(owned);
            port.postMessage({ type: "end" });
            port.close();
            return;
          }
          bytes += part.value.byteLength;
          totalBytes += part.value.byteLength;
          if (bytes > 8 * 1024 * 1024 || totalBytes > 32 * 1024 * 1024)
            throw new Error("Byte limit");
          const data = part.value.slice().buffer;
          port.postMessage({ type: "chunk", bytes: data }, [data]);
          document.querySelector("#stats")!.textContent =
            `${fileCount} reads · ${Math.ceil(totalBytes / 1024)} KiB · ${connection ? "encrypted relay" : "local fixture"}`;
        } catch (error) {
          port.postMessage({ type: "error", error: String(error) });
          await owned.cancel().catch(() => {});
          readers.delete(owned);
          port.close();
        }
      };
    } catch (error) {
      port.postMessage({ status: 502, error: String(error) });
      port.close();
    } finally {
      pending--;
    }
  };
  const ready = (event: MessageEvent) => {
    if (
      event.source !== frame.contentWindow ||
      event.origin !== contentOrigin ||
      event.data?.type !== "content-ready" ||
      event.data.viewerId !== viewerId
    )
      return;
    window.removeEventListener("message", ready);
    frame.contentWindow!.postMessage(
      { type: "connect", entry: "report/index.html" },
      contentOrigin,
      [channel.port2],
    );
  };
  window.addEventListener("message", ready);
  frame.src = `${contentOrigin}/__ya/bootstrap.html?viewer=${viewerId}`;
  document.querySelector("#viewers")!.append(frame);
  const viewer = {
    frame,
    async close() {
      if (closed) return;
      closed = true;
      controller.abort();
      await Promise.allSettled([...readers].map((reader) => reader.cancel()));
      readers.clear();
      const acknowledgement = new Promise<void>((resolve) => {
        resolveClosed = resolve;
      });
      channel.port1.postMessage({ type: "close" });
      await Promise.race([
        acknowledgement,
        new Promise((resolve) => setTimeout(resolve, 1000)),
      ]);
      channel.port1.close();
      channel.port2.close();
      window.removeEventListener("message", ready);
      frame.remove();
      viewers.delete(viewerId);
      events.push({ type: "disposed", viewerId });
    },
  };
  viewers.set(viewerId, viewer);
  return viewerId;
}
globalForTest.openViewer = openViewer;
globalForTest.closeViewers = () =>
  Promise.all([...viewers.values()].map((viewer) => viewer.close()));
globalForTest.shutdown = async () => {
  await Promise.all([...viewers.values()].map((viewer) => viewer.close()));
  connection?.close();
};
document.querySelector("#stop")!.addEventListener("click", () => {
  void (globalForTest.closeViewers as () => Promise<unknown>)();
});
async function start() {
  if (config.relayUrl) {
    const ws = await openRelayClientSocket({
      relayUrl: config.relayUrl,
      relayUsername: config.username,
    });
    connection = await SecureConnection.connectWithExistingSocket(
      ws,
      config.username,
      config.password,
      {},
      { relayUrl: config.relayUrl, relayUsername: config.username },
    );
    globalForTest.authenticated = connection.isAuthenticated();
  }
  await openViewer();
}
void start().catch((error) => {
  status.textContent = String(error);
  events.push({ type: "parent-error", error: String(error) });
});
