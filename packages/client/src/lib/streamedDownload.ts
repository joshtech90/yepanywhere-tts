import { downloadBlob } from "./imageActions";
import { generateUUID } from "./uuid";

/**
 * Path under the service worker's scope that serves one registered download.
 * `public/sw.js` answers it; keep the two in step.
 */
const STREAMED_DOWNLOAD_PATH = "__ya-download";
/** Messages to the worker keep it alive while the browser is still saving. */
const KEEPALIVE_INTERVAL_MS = 10_000;

/** Whether a service worker controls this page and can serve a download. */
export function canStreamDownloadToDisk(): boolean {
  return (
    typeof navigator !== "undefined" &&
    navigator.serviceWorker?.controller != null &&
    typeof MessageChannel === "function"
  );
}

type WorkerMessage =
  | { type: "registered" }
  | { type: "pull" }
  | { type: "cancel" }
  | { type: "expired" };

function transferable(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
  return bytes.byteOffset === 0 &&
    bytes.byteLength === bytes.buffer.byteLength &&
    bytes.buffer instanceof ArrayBuffer
    ? (bytes as Uint8Array<ArrayBuffer>)
    : bytes.slice();
}

/**
 * Saves a response body as a browser download without collecting it in the
 * page. The service worker serves the body at a one-time URL, and pulls each
 * piece from this page only as the browser writes the previous one, so a
 * streamed body moves at the pace of the disk.
 *
 * Resolves once the body has been handed over or the user cancelled the
 * download; rejects when the body cannot be read. A browser that never
 * requests the worker's URL gets the body as a `Blob` download instead.
 */
export async function saveStreamedDownload(
  response: Response,
  fileName: string,
): Promise<void> {
  const worker = navigator.serviceWorker?.controller;
  if (!worker || !response.body) {
    throw new Error("Streamed downloads need a service worker and a body");
  }
  const { scope } = await navigator.serviceWorker.ready;
  const id = generateUUID();
  const reader = response.body.getReader();
  const channel = new MessageChannel();
  const port = channel.port1;
  const frame = document.createElement("iframe");
  frame.hidden = true;
  const contentType =
    response.headers.get("content-type") ?? "application/octet-stream";

  return new Promise<void>((resolve, reject) => {
    const keepalive = setInterval(() => {
      worker.postMessage({ type: "streamed-download-keepalive", id });
    }, KEEPALIVE_INTERVAL_MS);
    let settled = false;
    const finish = (error?: Error, cancelBody = false) => {
      if (settled) return;
      settled = true;
      clearInterval(keepalive);
      port.close();
      // The worker's response owns the transfer now; leave the frame until
      // the browser has had time to hand it to the download manager.
      setTimeout(() => frame.remove(), KEEPALIVE_INTERVAL_MS);
      if (cancelBody) void reader.cancel().catch(() => undefined);
      if (error) reject(error);
      else resolve();
    };

    port.onmessage = (event: MessageEvent<WorkerMessage>) => {
      switch (event.data?.type) {
        case "registered":
          // A frame navigation reaches the worker's fetch handler; a
          // download-attribute link does not in every browser.
          frame.src = new URL(
            `${STREAMED_DOWNLOAD_PATH}/${id}/${encodeURIComponent(fileName)}`,
            scope,
          ).href;
          document.body.append(frame);
          return;
        case "pull":
          reader.read().then(
            ({ done, value }) => {
              if (settled) return;
              if (done) {
                port.postMessage({ type: "done" });
                finish();
                return;
              }
              const bytes = transferable(value);
              port.postMessage({ type: "chunk", bytes }, [bytes.buffer]);
            },
            (error: unknown) => {
              const failure =
                error instanceof Error ? error : new Error(String(error));
              port.postMessage({ type: "error", message: failure.message });
              finish(failure);
            },
          );
          return;
        case "cancel":
          finish(undefined, true);
          return;
        case "expired":
          // The browser never asked the worker for the URL, so nothing has
          // been read yet: save the body the way a page without a worker does.
          if (settled) return;
          settled = true;
          clearInterval(keepalive);
          port.close();
          frame.remove();
          collectBody(reader, contentType).then((blob) => {
            downloadBlob(blob, fileName);
            resolve();
          }, reject);
          return;
      }
    };

    worker.postMessage(
      {
        type: "streamed-download",
        id,
        fileName,
        contentType,
        length: response.headers.get("content-length"),
      },
      [channel.port2],
    );
  });
}

async function collectBody(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  type: string,
): Promise<Blob> {
  const parts: Uint8Array<ArrayBuffer>[] = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) return new Blob(parts, { type });
    parts.push(transferable(value));
  }
}
