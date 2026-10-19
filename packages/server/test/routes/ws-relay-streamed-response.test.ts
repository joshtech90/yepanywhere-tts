import type { HttpBindings } from "@hono/node-server";
import {
  BinaryFormat,
  RELAY_RESPONSE_STREAM_CHUNK_BYTES,
  RELAY_RESPONSE_STREAM_IDLE_TIMEOUT_MS,
  RELAY_RESPONSE_STREAM_WINDOW_BYTES,
  TransportChunkReassembler,
  type YepMessage,
  decodeResponseChunkPayload,
} from "@yep-anywhere/shared";
import { Hono } from "hono";
import { afterEach, describe, expect, it, vi } from "vitest";
import { decryptBinaryEnvelopeRaw } from "../../src/crypto/index.js";
import { getLogger } from "../../src/logging/logger.js";
import {
  type ConnectionState,
  RELAY_BINARY_RESPONSE_MAX_BYTES,
  cleanupConnectionState,
  createConnectionState,
  createSendFn,
  handleRequest,
  handleResponseStreamAck,
  handleResponseStreamCancel,
} from "../../src/routes/ws-relay-handlers.js";

const REQUEST_ID = "3f1b2a4c-5d6e-4f70-8a9b-0c1d2e3f4a5b";
const sessionKey = new Uint8Array(32).fill(7);

type Received =
  | { kind: "message"; seq: number; msg: YepMessage }
  | { kind: "chunk"; seq: number; requestId: string; data: Uint8Array };

function setup(body: () => Response, path = "/api/file") {
  const app = new Hono<{ Bindings: HttpBindings }>();
  app.get(path.split("?")[0]!, body);
  const state = createConnectionState();
  state.authState = "authenticated";
  state.sessionKey = sessionKey;
  state.supportedFormats = new Set([
    BinaryFormat.JSON,
    BinaryFormat.TRANSPORT_CHUNK,
  ]);
  const received: Received[] = [];
  const reassembler = new TransportChunkReassembler();
  const closes: unknown[] = [];
  const ws = {
    send: (frame: string | ArrayBuffer | Uint8Array) => {
      if (typeof frame === "string") throw new Error("Expected binary");
      const envelope = reassembler.acceptFrame(frame);
      if (!envelope) return;
      const decrypted = decryptBinaryEnvelopeRaw(envelope, sessionKey);
      if (!decrypted) throw new Error("Undecryptable frame");
      if (decrypted.format === BinaryFormat.RESPONSE_CHUNK) {
        received.push({
          kind: "chunk",
          ...decodeResponseChunkPayload(decrypted.payload),
        });
        return;
      }
      const { seq, msg } = JSON.parse(
        new TextDecoder().decode(decrypted.payload),
      ) as { seq: number; msg: YepMessage };
      received.push({ kind: "message", seq, msg });
    },
    close: (code?: number) => {
      closes.push(code);
    },
  };
  const request = (stream: boolean | "connection" = true, id = REQUEST_ID) =>
    handleRequest(
      {
        type: "request",
        id,
        method: "GET",
        path,
        ...(stream ? { stream } : {}),
      },
      createSendFn(ws, state),
      ws,
      app,
      "http://localhost",
      state,
    );
  return { state, received, closes, request };
}

function chunkBytes(received: Received[]): number {
  return received.reduce(
    (sum, item) => sum + (item.kind === "chunk" ? item.data.byteLength : 0),
    0,
  );
}

function messages(received: Received[]): YepMessage[] {
  return received.flatMap((item) =>
    item.kind === "message" ? [item.msg] : [],
  );
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 5));

function attachmentResponse(bytes: Uint8Array<ArrayBuffer>): Response {
  return new Response(bytes, {
    headers: {
      "Content-Type": "application/octet-stream",
      "Content-Disposition": "attachment",
      "Content-Length": String(bytes.byteLength),
    },
  });
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("streamed relay responses", () => {
  it("preserves future reader space through tail retirement while lending a lone body multiple chunks", async () => {
    let calls = 0;
    const floor = RELAY_RESPONSE_STREAM_CHUNK_BYTES / 2;
    const { state, received, request } = setup(() => {
      const index = calls++;
      if (index !== 1)
        return attachmentResponse(new Uint8Array(index === 0 ? 1 : 2 * floor));
      return new Response(
        new ReadableStream<Uint8Array>({
          // Non-aligned producer pieces expose reservation loss that full-size
          // chunks can conceal through rounding at the window boundary.
          pull(controller) {
            controller.enqueue(new Uint8Array(floor - 1));
          },
        }),
        { headers: { "Content-Type": "application/octet-stream" } },
      );
    });
    const tailId = "3f1b2a4c-5d6e-4f70-8a9b-000000000000";
    await request("connection", tailId); // completed, but its byte is not ACKed
    const large = request("connection");
    const ids = Array.from(
      { length: 7 },
      (_, i) => `3f1b2a4c-5d6e-4f70-8a9b-${String(i + 1).padStart(12, "0")}`,
    );
    const small: Promise<void>[] = [];
    try {
      await vi.waitFor(() =>
        expect(chunkBytes(received)).toBe(1 + 9 * (floor - 1)),
      );
      // Nine pieces before any ACK: a lone transfer is not stop-and-wait.
      // Retiring a tiny tail must return its floor to the future-slot pool.
      handleResponseStreamAck(state, tailId, 1);
      small.push(...ids.map((id) => request("connection", id)));
      await vi.waitFor(() =>
        expect(
          ids.every((id) =>
            received.some(
              (item) => item.kind === "chunk" && item.requestId === id,
            ),
          ),
        ).toBe(true),
      );
      for (const id of ids) handleResponseStreamAck(state, id, floor);
      await Promise.all(small);
      for (const id of ids)
        expect(messages(received)).toContainEqual(
          expect.objectContaining({ type: "response_stream_end", id }),
        );
      expect(messages(received)).not.toContainEqual(
        expect.objectContaining({
          type: "response_stream_end",
          id: REQUEST_ID,
        }),
      );
      expect(state.responseStreamBytes).toBeLessThanOrEqual(
        RELAY_RESPONSE_STREAM_WINDOW_BYTES,
      );
    } finally {
      cleanupConnectionState(state);
      await Promise.all([large, ...small]);
    }
  });

  it("renews completed-tail receipt deadlines only on earned progress", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    const { state, request, closes } = setup(() =>
      attachmentResponse(new Uint8Array(3)),
    );
    await request("connection");
    for (let bytes = 1; bytes <= 2; bytes++) {
      await vi.advanceTimersByTimeAsync(60_000);
      handleResponseStreamAck(state, REQUEST_ID, bytes);
    }
    await vi.advanceTimersByTimeAsync(60_000);
    expect(closes).toEqual([]);
    handleResponseStreamAck(state, REQUEST_ID, 2);
    handleResponseStreamAck(state, REQUEST_ID, 4);
    await vi.advanceTimersByTimeAsync(75_001);
    expect(closes).toEqual([1008]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("keeps browser stall deadlines independent of sibling progress", async () => {
    const warning = vi
      .spyOn(getLogger(), "warn")
      .mockImplementation(() => undefined);
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    const { state, received, request } = setup(() =>
      attachmentResponse(
        new Uint8Array(4 * RELAY_RESPONSE_STREAM_WINDOW_BYTES),
      ),
    );
    const siblingId = "3f1b2a4c-5d6e-4f70-8a9b-000000000001";
    const first = request();
    const sibling = request(true, siblingId);
    try {
      await vi.advanceTimersByTimeAsync(60_000);
      handleResponseStreamAck(
        state,
        siblingId,
        RELAY_RESPONSE_STREAM_CHUNK_BYTES,
      );
      await vi.advanceTimersByTimeAsync(60_001);
      await first;
      expect(warning).toHaveBeenCalledWith(
        expect.stringContaining(
          "The client stopped reading the streamed response",
        ),
      );
      expect(messages(received)).toContainEqual(
        expect.objectContaining({
          type: "response_stream_end",
          id: REQUEST_ID,
          error: expect.stringContaining("stopped reading"),
        }),
      );
    } finally {
      cleanupConnectionState(state);
      await sibling;
    }
  });

  it("shares native credit across completed unread bodies and rejects unearned ACKs", async () => {
    const size = RELAY_RESPONSE_STREAM_CHUNK_BYTES;
    const { state, received, request } = setup(() =>
      attachmentResponse(new Uint8Array(size)),
    );
    const ids = Array.from(
      { length: 9 },
      (_, i) => `3f1b2a4c-5d6e-4f70-8a9b-${String(i).padStart(12, "0")}`,
    );
    const running = ids.map((id) => request("connection", id));
    try {
      await vi.waitFor(() =>
        expect(chunkBytes(received)).toBe(RELAY_RESPONSE_STREAM_WINDOW_BYTES),
      );
      expect(state.responseStreamBytes).toBe(
        RELAY_RESPONSE_STREAM_WINDOW_BYTES,
      );
      const completed = messages(received).filter(
        (m) => m.type === "response_stream_end",
      );
      expect(completed.length).toBeGreaterThan(0);
      const completedId = completed[0]!.id;
      handleResponseStreamAck(state, completedId, size + 1);
      handleResponseStreamAck(state, completedId, Number.NaN);
      handleResponseStreamAck(state, completedId, size - 0.5);
      expect(state.responseStreamBytes).toBe(
        RELAY_RESPONSE_STREAM_WINDOW_BYTES,
      );
      handleResponseStreamAck(state, completedId, size);
      handleResponseStreamAck(state, completedId, size);
      await Promise.all(running);
      expect(chunkBytes(received)).toBe(9 * size);
      expect(state.responseStreamBytes).toBe(
        RELAY_RESPONSE_STREAM_WINDOW_BYTES,
      );
      for (const id of ids) handleResponseStreamAck(state, id, size);
      expect(state.responseStreamBytes).toBe(0);
      expect(state.responseStreams.size).toBe(0);
    } finally {
      cleanupConnectionState(state);
      await Promise.all(running);
    }
  });

  it("keeps cancelled tails charged until receipt and preserves browser mode", async () => {
    const { state, received, request } = setup(() =>
      attachmentResponse(
        new Uint8Array(2 * RELAY_RESPONSE_STREAM_WINDOW_BYTES),
      ),
    );
    const ids = Array.from(
      { length: 8 },
      (_, i) => `3f1b2a4c-5d6e-4f70-8a9b-${String(i).padStart(12, "0")}`,
    );
    const running = ids.map((id) => request("connection", id));
    try {
      await vi.waitFor(() =>
        expect(chunkBytes(received)).toBe(RELAY_RESPONSE_STREAM_WINDOW_BYTES),
      );
      const delivered = new Map(
        ids.map((id) => [
          id,
          received.reduce(
            (sum, item) =>
              sum +
              (item.kind === "chunk" && item.requestId === id
                ? item.data.length
                : 0),
            0,
          ),
        ]),
      );
      for (const id of ids) handleResponseStreamCancel(state, id);
      await Promise.all(running);
      expect(state.responseStreamBytes).toBe(
        RELAY_RESPONSE_STREAM_WINDOW_BYTES,
      );
      expect(
        messages(received).filter((m) => m.type === "response_stream_end"),
      ).toHaveLength(8);
      const browser = request(true, REQUEST_ID);
      running.push(browser);
      await vi.waitFor(() =>
        expect(chunkBytes(received)).toBe(
          2 * RELAY_RESPONSE_STREAM_WINDOW_BYTES,
        ),
      );
      // Browser mode retains its existing independent per-response budget.
      expect(state.responseStreamBytes).toBe(
        RELAY_RESPONSE_STREAM_WINDOW_BYTES,
      );
      handleResponseStreamCancel(state, REQUEST_ID);
      await browser;
      for (const [id, bytes] of delivered)
        handleResponseStreamAck(state, id, bytes);
      expect(state.responseStreamBytes).toBe(0);
      expect(state.responseStreams.size).toBe(0);
    } finally {
      cleanupConnectionState(state);
      await Promise.all(running);
    }
  });

  it("closes a native connection instead of freeing unacknowledged completed tails on expiry", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const { state, request, closes } = setup(() =>
      attachmentResponse(new Uint8Array(17)),
    );
    await request("connection");
    expect(state.responseStreamBytes).toBe(17);
    await vi.advanceTimersByTimeAsync(
      RELAY_RESPONSE_STREAM_IDLE_TIMEOUT_MS + 15_001,
    );
    expect(closes).toEqual([1008]);
    expect(state.cleanupStarted).toBe(true);
    expect(state.responseStreamBytes).toBe(0);
    expect(state.responseStreams.size).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("delivers a bootstrap part before completion and cancels a quiet producer", async () => {
    let producer!: ReadableStreamDefaultController<Uint8Array>;
    const cancelled = vi.fn();
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        producer = controller;
      },
      cancel: cancelled,
    });
    const { state, received, request } = setup(
      () =>
        new Response(body, {
          headers: { "Content-Type": "text/event-stream" },
        }),
      "/api/settings?bootstrap=new-session-v1",
    );
    const running = request();
    try {
      const first = new TextEncoder().encode(
        'event: bootstrap\ndata: {"part":"projects","status":200,"body":{"projects":[]}}\n\n',
      );
      producer.enqueue(first);
      await vi.waitFor(() =>
        expect(chunkBytes(received)).toBe(first.byteLength),
      );
      expect(messages(received).map((message) => message.type)).toEqual([
        "response_stream_start",
      ]);
      expect(state.responseStreams.size).toBe(1);
      handleResponseStreamCancel(state, REQUEST_ID);
      await running;
      expect(cancelled).toHaveBeenCalledOnce();
      expect(state.responseStreams.size).toBe(0);
    } finally {
      cleanupConnectionState(state);
      await running;
    }
  });

  it("streams a body past the single-message limit within the client's window", async () => {
    // Larger than one relayed response may be, so only streaming can carry it.
    const size = RELAY_BINARY_RESPONSE_MAX_BYTES + 3;
    const bytes = new Uint8Array(size);
    for (let i = 0; i < size; i += 4093) bytes[i] = i % 251;
    const { state, received, request } = setup(() => attachmentResponse(bytes));

    const done = request();
    let finished = false;
    void done.then(() => {
      finished = true;
    });
    let delivered = 0;
    let acked = 0;
    let checksum = 0;
    while (!finished) {
      await settle();
      for (const item of received) {
        if (item.kind !== "chunk") continue;
        delivered += item.data.byteLength;
        for (const byte of item.data) checksum += byte;
      }
      // Keep only messages; the test must not hold the whole body either.
      received.splice(
        0,
        received.length,
        ...received.filter((item) => item.kind === "message"),
      );
      expect(delivered - acked).toBeLessThanOrEqual(
        RELAY_RESPONSE_STREAM_WINDOW_BYTES,
      );
      acked = delivered;
      handleResponseStreamAck(state, REQUEST_ID, acked);
    }
    await done;

    let expected = 0;
    for (const byte of bytes) expected += byte;
    expect(delivered).toBe(size);
    expect(checksum).toBe(expected);
    expect(messages(received).map((msg) => msg.type)).toEqual([
      "response_stream_start",
      "response_stream_end",
    ]);
    expect(state.responseStreams.size).toBe(0);
  }, 60_000);

  it("delivers exact bytes and sequences chunks with the other messages", async () => {
    const size = 3 * RELAY_RESPONSE_STREAM_CHUNK_BYTES + 17;
    const bytes = new Uint8Array(size).map((_, i) => (i * 31) % 256);
    const { state, received, request } = setup(() => attachmentResponse(bytes));

    const done = request();
    // Everything fits the first window, so no acknowledgement is needed.
    await done;

    const start = received[0];
    expect(start).toMatchObject({
      kind: "message",
      msg: {
        type: "response_stream_start",
        id: REQUEST_ID,
        status: 200,
        length: size,
        headers: { "content-type": "application/octet-stream" },
      },
    });
    expect(received.at(-1)).toMatchObject({
      kind: "message",
      msg: { type: "response_stream_end", id: REQUEST_ID },
    });
    expect(
      (received.at(-1) as unknown as { msg: Record<string, unknown> }).msg,
    ).not.toHaveProperty("error");
    const chunks = received.filter((item) => item.kind === "chunk");
    expect(chunks.every((chunk) => chunk.requestId === REQUEST_ID)).toBe(true);
    expect(
      chunks.every(
        (chunk) => chunk.data.byteLength <= RELAY_RESPONSE_STREAM_CHUNK_BYTES,
      ),
    ).toBe(true);
    const joined = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      joined.set(chunk.data, offset);
      offset += chunk.data.byteLength;
    }
    expect(offset).toBe(size);
    // Deep equality walks a typed array element by element: the whole test
    // took 664ms here and exceeded 5s on loaded CI (graehl 37211422041).
    expect(Buffer.compare(joined, bytes)).toBe(0);
    expect(received.map((item) => item.seq)).toEqual(
      received.map((_, index) => index),
    );
    expect(state.nextOutboundSeq).toBe(received.length);
  });

  it("stops reading when the client cancels", async () => {
    let pulls = 0;
    const body = () =>
      new Response(
        new ReadableStream<Uint8Array>({
          pull(controller) {
            pulls += 1;
            controller.enqueue(
              new Uint8Array(RELAY_RESPONSE_STREAM_CHUNK_BYTES),
            );
          },
        }),
        { headers: { "Content-Type": "video/mp4" } },
      );
    const { state, received, request } = setup(body);

    const done = request();
    await settle();
    expect(chunkBytes(received)).toBe(RELAY_RESPONSE_STREAM_WINDOW_BYTES);
    handleResponseStreamCancel(state, REQUEST_ID);
    await done;
    const pullsAtCancel = pulls;
    await settle();

    expect(pulls).toBe(pullsAtCancel);
    expect(messages(received).map((msg) => msg.type)).toEqual([
      "response_stream_start",
    ]);
    expect(state.responseStreams.size).toBe(0);
  });

  it("releases a waiting stream when the connection closes", async () => {
    const { state, request } = setup(() =>
      attachmentResponse(
        new Uint8Array(4 * RELAY_RESPONSE_STREAM_WINDOW_BYTES),
      ),
    );
    const done = request();
    await settle();
    expect(state.responseStreams.size).toBe(1);
    cleanupConnectionState(state as ConnectionState);
    await done;
    expect(state.responseStreams.size).toBe(0);
  });

  it("ends with an error when the client stops consuming", async () => {
    const warning = vi
      .spyOn(getLogger(), "warn")
      .mockImplementation(() => undefined);
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const { received, request } = setup(() =>
      attachmentResponse(
        new Uint8Array(4 * RELAY_RESPONSE_STREAM_WINDOW_BYTES),
      ),
    );
    const done = request();
    await vi.advanceTimersByTimeAsync(
      RELAY_RESPONSE_STREAM_IDLE_TIMEOUT_MS + 1,
    );
    await done;
    expect(warning).toHaveBeenCalledWith(
      expect.stringContaining(
        "The client stopped reading the streamed response",
      ),
    );
    expect(messages(received).at(-1)).toMatchObject({
      type: "response_stream_end",
      error: expect.stringContaining("stopped reading"),
    });
  });

  it("answers an error status with one response even when asked to stream", async () => {
    const { received, request } = setup(() =>
      Response.json({ error: "Not found" }, { status: 404 }),
    );
    await request();
    expect(messages(received)).toEqual([
      expect.objectContaining({ type: "response", status: 404 }),
    ]);
  });
});
