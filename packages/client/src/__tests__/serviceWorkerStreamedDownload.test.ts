// @vitest-environment node

import { readFileSync } from "node:fs";
import vm from "node:vm";
import { describe, expect, it, vi } from "vitest";

const serviceWorkerSource = readFileSync(
  new URL("../../public/sw.js", import.meta.url),
  "utf8",
);
const SCOPE = "https://example.test/remote/";

type Listener = (event: unknown) => unknown;

function loadServiceWorker() {
  const listeners = new Map<string, Listener>();
  const workerGlobal = {
    addEventListener: (type: string, listener: Listener) => {
      listeners.set(type, listener);
    },
    skipWaiting: vi.fn(),
    clients: { claim: vi.fn(async () => undefined) },
    registration: { scope: SCOPE },
  };
  const context = vm.createContext({
    Date,
    Headers,
    ReadableStream,
    Response,
    URL,
    Uint8Array,
    clearTimeout,
    console: { error: vi.fn(), log: vi.fn(), warn: vi.fn() },
    encodeURIComponent,
    self: workerGlobal,
    setTimeout,
  });
  new vm.Script(serviceWorkerSource, { filename: "sw.js" }).runInContext(
    context,
  );
  const fetchFor = (path: string): Promise<Response> | undefined => {
    let responded: Promise<Response> | undefined;
    void listeners.get("fetch")?.({
      request: {
        url: new URL(path, SCOPE).href,
        method: "GET",
        mode: "navigate",
      },
      respondWith: (value: Response | Promise<Response>) => {
        responded = Promise.resolve(value);
      },
    });
    return responded;
  };
  const message = (data: unknown, ports: MessagePort[] = []) =>
    listeners.get("message")?.({ data, ports });
  return { fetchFor, message };
}

/** Plays the page's half: answers each pull with the next piece. */
function pageSide(port: MessagePort, pieces: Uint8Array[]) {
  const received: string[] = [];
  port.onmessage = (event: MessageEvent) => {
    received.push(event.data.type);
    if (event.data.type !== "pull") return;
    const next = pieces.shift();
    if (next) port.postMessage({ type: "chunk", bytes: next }, [next.buffer]);
    else port.postMessage({ type: "done" });
  };
  return received;
}

const nextTurn = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("service worker streamed downloads", () => {
  it("serves a registered body as an attachment, pulling it from the page", async () => {
    const { fetchFor, message } = loadServiceWorker();
    const channel = new MessageChannel();
    const received = pageSide(channel.port1, [
      new Uint8Array([1, 2, 3]),
      new Uint8Array([4, 5]),
    ]);
    await message(
      {
        type: "streamed-download",
        id: "dl-1",
        fileName: "report 1.bin",
        contentType: "application/octet-stream",
        length: "5",
      },
      [channel.port2],
    );
    await nextTurn();
    expect(received).toEqual(["registered"]);

    const response = await fetchFor("__ya-download/dl-1/report%201.bin");
    expect(response?.status).toBe(200);
    expect(response?.headers.get("content-disposition")).toBe(
      "attachment; filename*=UTF-8''report%201.bin",
    );
    expect(response?.headers.get("content-length")).toBe("5");
    expect(new Uint8Array(await response!.arrayBuffer())).toEqual(
      new Uint8Array([1, 2, 3, 4, 5]),
    );
    channel.port1.close();
  });

  it("serves each registration once", async () => {
    const { fetchFor, message } = loadServiceWorker();
    const channel = new MessageChannel();
    pageSide(channel.port1, []);
    await message({ type: "streamed-download", id: "dl-2" }, [channel.port2]);
    await (await fetchFor("__ya-download/dl-2/x"))!.arrayBuffer();

    expect((await fetchFor("__ya-download/dl-2/x"))?.status).toBe(404);
    channel.port1.close();
  });

  it("tells the page when the browser cancels the download", async () => {
    const { fetchFor, message } = loadServiceWorker();
    const channel = new MessageChannel();
    const received = pageSide(channel.port1, [new Uint8Array([9])]);
    await message({ type: "streamed-download", id: "dl-3" }, [channel.port2]);
    const response = await fetchFor("__ya-download/dl-3/x");
    await response!.body!.cancel();
    await nextTurn();

    expect(received).toContain("cancel");
    channel.port1.close();
  });
});
