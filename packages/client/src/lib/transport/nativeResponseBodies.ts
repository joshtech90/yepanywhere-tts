import type { RelayResponse } from "@yep-anywhere/shared";
import {
  toFetchResponse,
  createRelayApiError,
  resolveRelayRedirectPath,
} from "../connection/RelayProtocol";
import type { NativeTransportBridge } from "../nativeTransportBridge";

interface Head extends RelayResponse {
  streaming: boolean;
  responseId?: string;
  length?: number;
}

/** Native reads advance only when the Response consumer pulls another chunk. */
export class NativeResponseBodies {
  private readonly active = new Set<AbortController>();
  private admitted = 0;
  private readonly waiting: { grant: () => void; abort: () => void }[] = [];
  constructor(private readonly bridge: NativeTransportBridge) {}

  private async admit(signal: AbortSignal): Promise<() => void> {
    if (signal.aborted) throw signal.reason;
    if (this.admitted >= 8 || this.waiting.length) {
      if (this.waiting.length >= 64)
        throw new Error("Native response queue limit exceeded");
      await new Promise<void>((resolve, reject) => {
        const waiter = {
          grant: () => {
            signal.removeEventListener("abort", waiter.abort);
            this.admitted++;
            resolve();
          },
          abort: () => {
            const index = this.waiting.indexOf(waiter);
            if (index >= 0) this.waiting.splice(index, 1);
            reject(signal.reason);
          },
        };
        this.waiting.push(waiter);
        signal.addEventListener("abort", waiter.abort, { once: true });
      });
    } else this.admitted++;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.admitted--;
      this.waiting.shift()?.grant();
    };
  }

  cancelAll(error: Error): void {
    for (const controller of [...this.active]) controller.abort(error);
  }

  async fetch(path: string, init?: RequestInit): Promise<Response> {
    path = path.startsWith("/api") ? path : `/api${path}`;
    const requestHeaders = new Headers(init?.headers);
    requestHeaders.set("X-Yep-Anywhere", "true");
    const abort = new AbortController();
    const abandon = () => abort.abort(init?.signal?.reason);
    if (init?.signal?.aborted) abandon();
    init?.signal?.addEventListener("abort", abandon, { once: true });
    this.active.add(abort);
    let releaseSlot: (() => void) | undefined;
    let id: string | undefined;
    let idle: ReturnType<typeof setTimeout> | undefined;
    let body: ReadableStreamDefaultController<Uint8Array> | undefined;
    let finished = false;
    const release = (cancel: boolean) => {
      if (finished) return;
      finished = true;
      clearTimeout(idle);
      this.active.delete(abort);
      init?.signal?.removeEventListener("abort", abandon);
      abort.signal.removeEventListener("abort", fail);
      if (cancel && id) this.bridge.cancelRequest(id);
      releaseSlot?.();
    };
    const fail = () => {
      if (finished) return;
      body?.error(
        abort.signal.reason ?? new DOMException("Aborted", "AbortError"),
      );
      release(true);
    };
    const progress = (timeout = 120_000) => {
      clearTimeout(idle);
      idle = setTimeout(
        () => abort.abort(new Error("Native response idle timeout")),
        timeout,
      );
    };
    abort.signal.addEventListener("abort", fail, { once: true });
    try {
      releaseSlot = await this.admit(abort.signal);
      if (finished) {
        releaseSlot();
        throw abort.signal.reason;
      }
      let head: Head;
      for (let redirects = 0; ; redirects++) {
        head = await this.bridge.request<Head>(
          "responseStart",
          {
            path,
            headers: Object.fromEntries(requestHeaders),
          },
          abort.signal,
        );
        id = head.responseId;
        if (abort.signal.aborted) throw abort.signal.reason;
        if (![301, 302, 303, 307, 308].includes(head.status)) break;
        if (id) this.bridge.cancelRequest(id);
        id = undefined;
        if (redirects >= 5)
          throw new Error("Relay request exceeded 5 redirects");
        path = resolveRelayRedirectPath(
          path,
          new Headers(head.headers).get("location") ?? undefined,
        );
      }
      if (head.status >= 400)
        throw Object.assign(createRelayApiError(head), {
          headers: new Headers(head.headers),
        });
      if (head.status >= 300 && head.status !== 304)
        throw new Error(`Unsupported relay response status: ${head.status}`);
      if (!head.streaming) {
        release(false);
        const download =
          new URL(path, "https://native.invalid").searchParams.get(
            "download",
          ) === "true";
        return toFetchResponse(head, download);
      }
      if (
        typeof id !== "string" ||
        !id ||
        (head.length !== undefined &&
          (!Number.isSafeInteger(head.length) || head.length < 0))
      )
        throw new Error("Invalid native response metadata");
      const headers = new Headers(head.headers);
      if (head.length !== undefined)
        headers.set("content-length", String(head.length));
      let received = 0;
      const stream = new ReadableStream<Uint8Array>(
        {
          start(controller) {
            body = controller;
            progress(15_000);
          },
          pull: async (controller) => {
            progress();
            try {
              const chunk = await this.bridge.request<
                Uint8Array | { done: true }
              >(
                "responseRead",
                { responseId: id },
                abort.signal,
                undefined,
                120_000,
              );
              if (finished) return;
              if (chunk instanceof Uint8Array) {
                if (!chunk.byteLength || chunk.byteLength > 128 * 1024)
                  throw new Error("Invalid native response chunk");
                received += chunk.byteLength;
                if (head.length !== undefined && received > head.length)
                  throw new Error("Native response exceeds its length");
                controller.enqueue(chunk);
                progress();
              } else {
                if (
                  chunk?.done !== true ||
                  (head.length !== undefined && received !== head.length)
                )
                  throw new Error("Incomplete native response");
                release(false);
                controller.close();
              }
            } catch (error) {
              if (!finished) {
                controller.error(error);
                release(true);
              }
            }
          },
          cancel: (reason) => {
            release(true);
            abort.abort(reason);
          },
        },
        { highWaterMark: 0 },
      );
      return new Response(stream, { status: head.status, headers });
    } catch (error) {
      release(true);
      throw error;
    }
  }
}
