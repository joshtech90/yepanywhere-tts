import type { HttpBindings } from "@hono/node-server";
import type { RelayResponse } from "@yep-anywhere/shared";
import {
  BinaryFormat,
  TRANSPORT_REASSEMBLY_MAX_BYTES,
  decodeJsonFrame,
} from "@yep-anywhere/shared";
import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import {
  RELAY_BINARY_RESPONSE_MAX_BYTES,
  createConnectionState,
  createSendFn,
  handleRequest,
} from "../../src/routes/ws-relay-handlers.js";

const attachment = {
  "Content-Type": "application/gzip",
  "Content-Disposition": "attachment",
};

async function relayResponse(response: Response, query = "") {
  const app = new Hono<{ Bindings: HttpBindings }>();
  app.get("/api/file", () => response);
  const state = createConnectionState();
  state.connectionPolicy = "local_unrestricted";
  state.authState = "authenticated";
  const frames: string[] = [];
  const ws = {
    send: (frame: string | ArrayBuffer | Uint8Array) => {
      frames.push(String(frame));
    },
    close: () => {},
  };
  await handleRequest(
    {
      type: "request",
      id: "download",
      method: "GET",
      path: `/api/file${query}`,
    },
    createSendFn(ws, state),
    ws,
    app,
    "http://localhost",
    state,
  );
  expect(frames).toHaveLength(1);
  return JSON.parse(frames[0]!) as RelayResponse;
}

describe("relay file downloads", () => {
  it.each([
    ["Markdown", "text/markdown", Buffer.from("# Hello\r\n雪 🎉\r\n")],
    ["JSON", "application/json", Buffer.from('{ "n": 9007199254740993 }\n')],
    ["empty text", "text/plain", Buffer.alloc(0)],
    ["non-UTF-8 text", "text/plain", Buffer.from([0xff, 0xfe, 0x61, 0])],
  ])("preserves exact %s download bytes", async (_name, contentType, bytes) => {
    const result = await relayResponse(
      new Response(bytes, { headers: { "Content-Type": contentType } }),
      "?download=true",
    );
    expect(result.status).toBe(200);
    expect(result.headers?.["content-type"]).toBe(contentType);
    expect(result.body).toEqual({
      _binary: true,
      data: bytes.toString("base64"),
    });
  });

  it.each(["attachment", 'Attachment; filename="README.md"'])(
    "honors %s disposition without a download query",
    async (disposition) => {
      const bytes = '{ "original": true }\r\n';
      const result = await relayResponse(
        new Response(bytes, {
          headers: {
            "Content-Type": "application/json",
            "Content-Disposition": disposition,
          },
        }),
      );
      expect(result.body).toEqual({
        _binary: true,
        data: Buffer.from(bytes).toString("base64"),
      });
    },
  );

  it.each(["", "?download=false"])(
    "keeps normal text and JSON viewing for query %s",
    async (query) => {
      const text = await relayResponse(
        new Response("# Read me\n", {
          headers: {
            "Content-Type": "text/markdown",
            "Content-Disposition": 'inline; filename="attachment.md"',
          },
        }),
        query,
      );
      expect(text.body).toBe("# Read me\n");
      const json = await relayResponse(
        Response.json({ content: "# Read me\n" }),
        query,
      );
      expect(json.body).toEqual({ content: "# Read me\n" });
    },
  );

  it.each([400, 403, 404, 500])(
    "preserves JSON and text errors with status %s",
    async (status) => {
      const headers = { "Content-Disposition": "attachment" };
      const json = await relayResponse(
        Response.json({ error: "Download unavailable" }, { status, headers }),
        "?download=true",
      );
      expect(json.status).toBe(status);
      expect(json.body).toEqual({ error: "Download unavailable" });
      const text = await relayResponse(
        new Response("Download unavailable", { status, headers }),
        "?download=true",
      );
      expect(text.status).toBe(status);
      expect(text.body).toBe("Download unavailable");
    },
  );

  it("refuses a declared oversized file without reading its body", async () => {
    let pulls = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulls += 1;
        controller.enqueue(new Uint8Array(1024));
      },
    });
    const result = await relayResponse(
      new Response(body, {
        headers: {
          ...attachment,
          "Content-Length": String(RELAY_BINARY_RESPONSE_MAX_BYTES + 1),
        },
      }),
    );
    expect(result.status).toBe(413);
    expect(result.body).toMatchObject({ retryable: false });
    expect(pulls).toBeLessThanOrEqual(1);
  });

  it("fails only the request when a relayed file exceeds one message", async () => {
    // Base64 inflates these bytes past the reassembly limit, though the raw
    // body is under the read bound; nothing compresses plaintext frames.
    const bytes = Buffer.alloc(Math.ceil(TRANSPORT_REASSEMBLY_MAX_BYTES * 0.8));
    const app = new Hono<{ Bindings: HttpBindings }>();
    app.get("/api/file", () => new Response(bytes, { headers: attachment }));
    const state = createConnectionState();
    state.connectionPolicy = "local_unrestricted";
    state.authState = "authenticated";
    state.useBinaryFrames = true;
    state.supportedFormats.add(BinaryFormat.TRANSPORT_CHUNK);
    const frames: ArrayBuffer[] = [];
    const closes: unknown[] = [];
    const ws = {
      send: (frame: string | ArrayBuffer | Uint8Array) => {
        frames.push(frame as ArrayBuffer);
      },
      close: (code?: number) => {
        closes.push(code);
      },
    };
    await handleRequest(
      { type: "request", id: "big", method: "GET", path: "/api/file" },
      createSendFn(ws, state),
      ws,
      app,
      "http://localhost",
      state,
    );
    expect(closes).toEqual([]);
    expect(frames).toHaveLength(1);
    const response = decodeJsonFrame<RelayResponse>(frames[0]!);
    expect(response).toMatchObject({ id: "big", status: 413 });
  });

  it("keeps ordinary image responses binary", async () => {
    const bytes = Buffer.from([137, 80, 78, 71]);
    const result = await relayResponse(
      new Response(bytes, { headers: { "Content-Type": "image/png" } }),
    );
    expect(result.body).toEqual({
      _binary: true,
      data: bytes.toString("base64"),
    });
  });
});
